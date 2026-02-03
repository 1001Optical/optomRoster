import {createSecret} from "@/utils/crypto";
import {checkIdentifierCount} from "@/lib/checkIdentifierCount";
import {apiFetch} from "@/services/apiFetch";

const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKENS

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
    console.log(`=== Creating Optomate Account ===`);
    console.log(`FirstName: ${firstName}, LastName: ${lastName}, Email: ${email}`);

    try {
        // 특수문자 제거
        const givenName = removeSpecialChars(firstName);
        const surname = removeSpecialChars(lastName);

        console.log(`Cleaned name - Given: ${givenName}, Surname: ${surname}`);

        // 특수문자 제거 후 빈 문자열 체크
        if (!givenName || !surname) {
            throw new Error(`Invalid name format after removing special characters: ${firstName} ${lastName}`);
        }
        
        // 이메일 검증
        if (!email || !email.includes('@')) {
            throw new Error(`Invalid email format: ${email}`);
        }
        
        console.log("Checking existing identifier count...");
        const identifier = await checkIdentifierCount(givenName, surname);
        console.log(`Current identifier count: ${identifier}`);
        
        const username = `${(givenName[0]+surname[0]+surname[1]).toUpperCase()}`;
        console.log(`Base username: ${username}`);
        
        let convertedData:{id: number, username: string} = {
            id: 0, username: ""
        };

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        let i = (identifier ?? 0) + 1;
        let u = 25;
        let attemptCount = 0;
        const maxAttempts = 20; // 무한 루프 방지
        
        console.log(`Starting account creation attempts (max ${maxAttempts})...`);
        
        while((i <= (identifier ?? 0) + 10 || u <= 35) && attemptCount < maxAttempts) {
            attemptCount++;
            console.log(`Attempt ${attemptCount}: IDENTIFIER=${givenName[0]+surname[0]+i}, USERNAME=${username}${u}`);
            
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

            console.log("BODY: ", body)
            console.log("Token: ", API_TOKEN)

            try {
                const result = await apiFetch(`${apiUrl}/api/optometrists/createUser`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        "Authorization": API_TOKEN ? `Bearer ${API_TOKEN}` : ""
                    },
                    body: JSON.stringify(body)
                });

                // if (!res.ok) {
                //     console.error(`API request failed with status: ${res.status} ${res.statusText}`);
                //     throw new Error(`API request failed: ${res.status}`);
                // }

                console.log(result)
                console.log(`API response:`, { success: result.success, error: result.error });

                if(result.success) {
                    convertedData = {
                        id: result.data.id,
                        username: `${username}${u}`
                    };
                    console.log(`Account created successfully:`, convertedData);
                    break;
                } else if(result.error) {
                    const error = CheckError(result?.details?.error?.message);
                    console.log(`Account creation failed, error type: ${error}`);
                    
                    if(error === "IDENTIFIER") {
                        i++;
                        console.log(`Incrementing IDENTIFIER to ${i}`);
                    } else if (error === "USERNAME") {
                        u++;
                        console.log(`Incrementing USERNAME to ${u}`);
                    } else {
                        console.error(`Unknown error type: ${error}`);
                        break; // 기본적으로 멈춤
                    }
                } else {
                    console.error("Unexpected API response format:", result);
                    break;
                }
            } catch (fetchError) {
                console.error(`Fetch error on attempt ${attemptCount}:`, fetchError);
                break;
            }
        }

        if (convertedData.id === 0) {
            throw new Error(`Failed to create account after ${attemptCount} attempts`);
        }

        console.log(`=== Account Creation Completed ===`);
        return convertedData;
    } catch (error) {
        console.error("Error in createOptomAccount:", error);
        throw error;
    }
}
