interface IEHClientProps {
    path: string
    init?: RequestInit
}

export const EmploymentHeroClient = async ({path, init}: IEHClientProps) => {
    const secret = process.env.EMPLOYMENTHERO_SECRET;
    const server_url = process.env.EMPLOYMENTHERO_API_URL;

    fetch(`${server_url}${path}`, {})
    return
}