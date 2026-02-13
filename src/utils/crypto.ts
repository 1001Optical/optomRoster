const toBase64 = (str: string): string => Buffer.from(str, "utf8").toString('base64');

const createSecret: (username: string, password?: string) => string = (username: string, password?: string) => {
    return `Basic ${toBase64(`${username}:${password ?? ""}`)}`;
};

const getOptomateAuthSecret = (): string => {
    const username = process.env.OPTOMATE_API_USERNAME;
    const password = process.env.OPTOMATE_API_PASSWORD;

    if (!username || !password) {
        throw new Error("Missing OPTOMATE_API_USERNAME or OPTOMATE_API_PASSWORD environment variable");
    }

    return createSecret(username, password);
};

export {createSecret, getOptomateAuthSecret};