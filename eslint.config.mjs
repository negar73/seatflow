import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat ESLint configuration.
 *
 * `react-hooks/set-state-in-effect` is disabled: the booking flow uses the
 * standard "initialize state from an async response inside an effect"
 * pattern in a handful of client components, which the (new and stricter)
 * React Hooks v6 rule flags even though the effects are guarded and safe.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
