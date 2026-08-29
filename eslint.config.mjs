import nextVitals from "eslint-config-next/core-web-vitals";
import { globalIgnores } from "eslint/config";

const config = [...nextVitals, globalIgnores(["qa/live/**"])];

export default config;
