import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDirPath, "..");
const envPath = path.join(projectRoot, ".env");

dotenv.config({ path: envPath });

export { envPath, projectRoot };
