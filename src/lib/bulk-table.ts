export type OrangeBookFileType = "products" | "patents" | "exclusivity";

export const FILE_NAMES: Record<OrangeBookFileType, string> = {
  products: "products.txt", patents: "patent.txt", exclusivity: "exclusivity.txt",
};
const COLUMNS: Record<OrangeBookFileType, string[]> = {
  products: ["Ingredient", "DF;Route", "Trade_Name", "Applicant", "Strength", "Appl_Type", "Appl_No", "Product_No", "TE_Code", "Approval_Date", "RLD", "RS", "Type", "Applicant_Full_Name"],
  patents: ["Appl_Type", "Appl_No", "Product_No", "Patent_No", "Patent_Expire_Date_Text", "Drug_Substance_Flag", "Drug_Product_Flag", "Patent_Use_Code", "Delist_Flag", "Submission_Date"],
  exclusivity: ["Appl_Type", "Appl_No", "Product_No", "Exclusivity_Code", "Exclusivity_Date"],
};

export function bulkError(message: string): never {
  throw new Error(`ORANGE_BOOK_BULK: ${message}`);
}

/** FDA columns are interpreted; values and additional columns remain verbatim. */
export function parseBulkTable(rawText: string, requestedType?: OrangeBookFileType) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject corrupt native text while allowing tab and line endings.
  if (rawText.length > 24 * 1024 * 1024 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(rawText)) bulkError("Unsupported table size or control character");
  const lines = rawText.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const headers = lines[0].split("~");
  const inferred = (Object.keys(COLUMNS) as OrangeBookFileType[]).filter(kind => COLUMNS[kind].every(column => headers.includes(column)));
  const kind = requestedType ?? (inferred.length === 1 ? inferred[0] : undefined);
  if (!kind || headers.length > 64 || headers.some(header => !header.trim() || header.length > 256) || new Set(headers).size !== headers.length
    || !COLUMNS[kind].every(column => headers.includes(column))) bulkError("Missing, duplicate or invalid table columns");
  if (lines.length > 250_001) bulkError("Table row limit exceeded");
  const records: Record<string, string>[] = [];
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line || line.length > 64 * 1024) bulkError(`Invalid or oversized row ${index}`);
    const values = line.split("~");
    if (values.length !== headers.length) bulkError(`Column count mismatch at row ${index}`);
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    if (!/^[NA]$/.test(record.Appl_Type) || !/^\d{6}$/.test(record.Appl_No) || !/^\d{3}$/.test(record.Product_No)
      || (kind === "patents" && !record.Patent_No.trim()) || (kind === "exclusivity" && !record.Exclusivity_Code.trim())) bulkError(`Invalid native identity at row ${index}`);
    records.push(record);
  }
  return { headers, records };
}

export function parseTildeDelimited(rawText: string, kind?: OrangeBookFileType): Record<string, string>[] {
  return parseBulkTable(rawText, kind).records;
}
