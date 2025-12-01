const toBase64 = (str: string): string => Buffer.from(str, "utf8").toString('base64');

const createSecret: (username: string, password?: string) => string = (username: string, password?: string) => {
    return `Basic ${toBase64(`${username}:${password ?? ""}`)}`;
};

export {createSecret};