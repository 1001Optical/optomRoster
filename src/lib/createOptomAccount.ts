import {apiFetch} from "@/services/apiFetch";
import { createLogger, maskEmail, maskName } from "@/lib/logger";

const logger = createLogger('CreateOptomAccount');
const API_TOKEN = process.env.API_TOKENS

const CheckError = (text:string) => {
    const re = /\b(IDENTIFIER|USERNAME)\b/i; // 1번 패턴
    const m = re.exec(text);

    if (m) {
        return m[1].toUpperCase(); // "IDENTIFIER" | "USERNAME"
    }
    return undefined;
}

// 특수문자 제거 함수 (알파벳, 숫자, 공백 유지)
const removeSpecialChars = (str: string): string => {
    return str.replace(/[^a-zA-Z0-9 ]/g, '');
}

export const createOptomAccount = async (id: string, firstName: string, lastName: string, email: string) => {
    logger.info(`Creating Optomate Account`, { name: `${maskName(firstName)} ${maskName(lastName)}`, email: maskEmail(email) });

    try {
        // 특수문자 제거
        const givenName = removeSpecialChars(firstName);
        const surname = removeSpecialChars(lastName);

        logger.debug(`Cleaned name`, { given: maskName(givenName), surname: maskName(surname) });

        // 특수문자 제거 후 빈 문자열 체크
        if (!givenName || !surname) {
            throw new Error(`Invalid name format after removing special characters: ${firstName} ${lastName}`);
        }

        // 이메일 검증
        if (!email || !email.includes('@')) {
            throw new Error(`Invalid email format: ${email}`);
        }

        const username = `${(givenName[0]+surname[0]+surname[1]).toUpperCase()}`;
        logger.debug(`Base username: ${username}`);

        let convertedData:{id: number, username: string} = {
            id: 0, username: ""
        };

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        let i = 1;
        let u = 1;
        let attemptCount = 0;
        const maxAttempts = 50; // 무한 루프 방지

        logger.debug(`Starting account creation attempts`, { maxAttempts });

        while(attemptCount < maxAttempts) {
            attemptCount++;
            logger.debug(`Attempt ${attemptCount}`, { identifier: givenName[0]+surname[0]+i, username: `${username}${u}` });

            const body = {
                "IDENTIFIER": givenName[0]+surname[0]+i,
                "GIVEN_NAME": givenName, // 특수문자 제거된 이름
                "SURNAME": surname, // 특수문자 제거된 성
                "USER_TYPE": 1,
                "USERNAME": `${username}${u}`,
                "PASSWORD": "1001",
                "EMAIL_ADDRESS": email,
                "IS_ADMINISTRATOR": false,
                "USE_APPBOOK": true,
                "IS_ROAMING_USER": true,
                "EXTERNAL_USER_ID": id
            };

            try {
                const result = await apiFetch(`${apiUrl}/api/optometrists/createUser`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        "Authorization": API_TOKEN ? `Bearer ${API_TOKEN}` : ""
                    },
                    body: JSON.stringify(body)
                });

                logger.debug(`API response`, { success: result.success, error: result.error });

                if(result.success) {
                    convertedData = {
                        id: result.data.id,
                        username: `${username}${u}`
                    };
                    logger.info(`Account created successfully`, { id: convertedData.id, username: convertedData.username });
                    break;
                } else if(result.error) {
                    const error = CheckError(result?.details?.error?.message);
                    logger.debug(`Account creation failed`, { errorType: error });

                    if(error === "IDENTIFIER") {
                        i++;
                        logger.debug(`Incrementing IDENTIFIER to ${i}`);
                    } else if (error === "USERNAME") {
                        u++;
                        logger.debug(`Incrementing USERNAME to ${u}`);
                    } else {
                        logger.error(`Unknown error type`, { error });
                        break; // 기본적으로 멈춤
                    }
                } else {
                    logger.error("Unexpected API response format");
                    break;
                }
            } catch (fetchError) {
                logger.error(`Fetch error on attempt ${attemptCount}`, { error: String(fetchError) });
                break;
            }
        }

        if (convertedData.id === 0) {
            throw new Error(`Failed to create account after ${attemptCount} attempts`);
        }

        logger.info(`Account creation completed`, { id: convertedData.id });
        return convertedData;
    } catch (error) {
        logger.error("Error in createOptomAccount", { error: String(error) });
        throw error;
    }
}
