import { strToU8, zipSync } from "fflate";

export const columns = {
  products: ["Ingredient", "DF;Route", "Trade_Name", "Applicant", "Strength", "Appl_Type", "Appl_No", "Product_No", "TE_Code", "Approval_Date", "RLD", "RS", "Type", "Applicant_Full_Name"],
  patents: ["Appl_Type", "Appl_No", "Product_No", "Patent_No", "Patent_Expire_Date_Text", "Drug_Substance_Flag", "Drug_Product_Flag", "Patent_Use_Code", "Delist_Flag", "Submission_Date"],
  exclusivity: ["Appl_Type", "Appl_No", "Product_No", "Exclusivity_Code", "Exclusivity_Date"],
};
export type FixtureKind = keyof typeof columns;
export const names = { products: "products.txt", patents: "patent.txt", exclusivity: "exclusivity.txt" };
export const rows = {
  products: { Appl_Type: "N", Appl_No: "000123", Product_No: "001", Ingredient: "Substance A; Substance B", "DF;Route": "TABLET;ORAL", Trade_Name: "Example", Applicant: "Party", Strength: "1MG;2MG", TE_Code: "", Approval_Date: "Approved prior to Jan 1, 1982", RLD: "RLD", RS: "RS", Type: "RX", Applicant_Full_Name: "Party Full Name" },
  patents: { Appl_Type: "N", Appl_No: "000123", Product_No: "001", Patent_No: "100*PED", Patent_Expire_Date_Text: "Jan 1, 2030", Drug_Substance_Flag: "Y", Drug_Product_Flag: "", Patent_Use_Code: "U-1", Delist_Flag: "", Submission_Date: "Jan 1, 2020" },
  exclusivity: { Appl_Type: "N", Appl_No: "000123", Product_No: "001", Exclusivity_Code: "NCE", Exclusivity_Date: "Jan 1, 2034" },
};
export function table(kind: FixtureKind, data: Array<Record<string, string>> = [rows[kind]], fields = columns[kind], newline = "\n"): string {
  return [fields.join("~"), ...data.map(row => fields.map(field => Object.prototype.hasOwnProperty.call(row, field) ? row[field] : "").join("~"))].join(newline) + newline;
}
export function archive(overrides: Record<string, string | Uint8Array> = {}): Uint8Array {
  const files = Object.fromEntries((Object.keys(names) as FixtureKind[]).map(kind => [names[kind], table(kind)]));
  return zipSync(Object.fromEntries(Object.entries({ ...files, ...overrides }).map(([name, value]) => [name, typeof value === "string" ? strToU8(value) : value])), { mtime: new Date("2026-10-05T00:00:00Z") });
}
