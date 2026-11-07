'use server';

import { fetchCompanyProfile, type CompanyProfileData } from "@/lib/company-profile";

export async function getCompanyProfileData(symbol: string): Promise<CompanyProfileData> {
    return await fetchCompanyProfile(symbol);
}
