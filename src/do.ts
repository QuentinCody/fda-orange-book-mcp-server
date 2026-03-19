import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class OrangeBookDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                // Products data
                if (
                    "Ingredient" in sample &&
                    ("DF_Route" in sample || "Trade_Name" in sample)
                ) {
                    return {
                        tableName: "products",
                        indexes: [
                            "Ingredient",
                            "DF_Route",
                            "Trade_Name",
                            "Applicant",
                            "Appl_No",
                            "Type",
                            "TE_Code",
                        ],
                    };
                }
                // Patent data
                if (
                    "Patent_No" in sample &&
                    ("Patent_Expire_Date_Text" in sample ||
                        "Drug_Substance_Flag" in sample)
                ) {
                    return {
                        tableName: "patents",
                        indexes: [
                            "Patent_No",
                            "Patent_Expire_Date_Text",
                            "Drug_Substance_Flag",
                            "Drug_Product_Flag",
                            "Appl_No",
                        ],
                    };
                }
                // Exclusivity data
                if (
                    "Exclusivity_Code" in sample &&
                    "Exclusivity_Date" in sample
                ) {
                    return {
                        tableName: "exclusivity",
                        indexes: [
                            "Exclusivity_Code",
                            "Exclusivity_Date",
                            "Appl_No",
                        ],
                    };
                }
            }
        }

        return undefined;
    }
}
