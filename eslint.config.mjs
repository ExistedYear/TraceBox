import nextVitals from "eslint-config-next/core-web-vitals";
import { globalIgnores } from "eslint/config";

export default [...nextVitals, globalIgnores(["qa/live/**"])];
