/**
 * Formula library (Direction B "Small" scope, per the owner-approved
 * proposal - see the "Formula Library & Special Character Picker" scoping
 * artifact): a curated set of common science/math formulas, browsable by
 * domain and searchable by name, replacing the raw `window.prompt`
 * formula-insert flow.
 *
 * Every entry's `latex` is plain LaTeX, verified against KaTeX 0.18's
 * supported command set (the actual rendering ceiling - see
 * `surface/renderer.ts`'s `KATEX_OPTIONS`, `{ trust: false, strict: "error"
 * }`). Chemistry entries use the `mhchem` extension's `\ce{...}` macro,
 * registered in `surface/renderer.ts` (core) for real document rendering
 * and in `FormulaLibraryPopover.tsx` for this library's own previews.
 *
 * `notation` is always `"latex"` - the schema also accepts `"mathml"`, but
 * the renderer never implements a MathML render path
 * (docs/bugs/formula-mathml-notation-not-rendered.md, open) - so no library
 * entry may use it.
 */

export type FormulaDomain = "algebra" | "geometry" | "calculus" | "physics" | "chemistry" | "statistics";

export interface FormulaLibraryEntry {
  readonly id: string;
  readonly domain: FormulaDomain;
  readonly name: string;
  readonly latex: string;
}

export const FORMULA_DOMAINS: readonly { readonly id: FormulaDomain; readonly label: string }[] = [
  { id: "algebra", label: "Algebra" },
  { id: "geometry", label: "Geometry" },
  { id: "calculus", label: "Calculus" },
  { id: "physics", label: "Physics" },
  { id: "chemistry", label: "Chemistry" },
  { id: "statistics", label: "Statistics" },
];

export const FORMULA_LIBRARY: readonly FormulaLibraryEntry[] = [
  // Algebra
  { id: "algebra-quadratic", domain: "algebra", name: "Quadratic formula", latex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" },
  { id: "algebra-binomial-sum-sq", domain: "algebra", name: "Square of a sum", latex: "(a+b)^2 = a^2 + 2ab + b^2" },
  { id: "algebra-binomial-diff-sq", domain: "algebra", name: "Square of a difference", latex: "(a-b)^2 = a^2 - 2ab + b^2" },
  { id: "algebra-diff-of-squares", domain: "algebra", name: "Difference of squares", latex: "a^2 - b^2 = (a+b)(a-b)" },
  { id: "algebra-exponent-product", domain: "algebra", name: "Exponent product rule", latex: "a^m \\cdot a^n = a^{m+n}" },
  { id: "algebra-exponent-power", domain: "algebra", name: "Exponent power rule", latex: "(a^m)^n = a^{mn}" },
  { id: "algebra-log-product", domain: "algebra", name: "Logarithm product rule", latex: "\\log_a(xy) = \\log_a x + \\log_a y" },
  { id: "algebra-log-quotient", domain: "algebra", name: "Logarithm quotient rule", latex: "\\log_a\\left(\\frac{x}{y}\\right) = \\log_a x - \\log_a y" },
  { id: "algebra-binomial-theorem", domain: "algebra", name: "Binomial theorem", latex: "(x+y)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^{n-k} y^k" },
  { id: "algebra-vertex", domain: "algebra", name: "Vertex of a parabola", latex: "x = -\\frac{b}{2a}" },

  // Geometry
  { id: "geometry-circle-area", domain: "geometry", name: "Circle area", latex: "A = \\pi r^2" },
  { id: "geometry-circle-circumference", domain: "geometry", name: "Circle circumference", latex: "C = 2\\pi r" },
  { id: "geometry-triangle-area", domain: "geometry", name: "Triangle area", latex: "A = \\frac{1}{2}bh" },
  { id: "geometry-sphere-volume", domain: "geometry", name: "Sphere volume", latex: "V = \\frac{4}{3}\\pi r^3" },
  { id: "geometry-sphere-surface", domain: "geometry", name: "Sphere surface area", latex: "A = 4\\pi r^2" },
  { id: "geometry-cylinder-volume", domain: "geometry", name: "Cylinder volume", latex: "V = \\pi r^2 h" },
  { id: "geometry-cone-volume", domain: "geometry", name: "Cone volume", latex: "V = \\frac{1}{3}\\pi r^2 h" },
  { id: "geometry-pythagorean", domain: "geometry", name: "Pythagorean theorem", latex: "a^2 + b^2 = c^2" },
  { id: "geometry-box-volume", domain: "geometry", name: "Rectangular box volume", latex: "V = lwh" },
  { id: "geometry-trapezoid-area", domain: "geometry", name: "Trapezoid area", latex: "A = \\frac{1}{2}(b_1+b_2)h" },

  // Calculus
  { id: "calculus-power-rule", domain: "calculus", name: "Power rule (derivative)", latex: "\\frac{d}{dx}x^n = nx^{n-1}" },
  { id: "calculus-product-rule", domain: "calculus", name: "Product rule", latex: "\\frac{d}{dx}[f(x)g(x)] = f'(x)g(x) + f(x)g'(x)" },
  { id: "calculus-quotient-rule", domain: "calculus", name: "Quotient rule", latex: "\\frac{d}{dx}\\left[\\frac{f(x)}{g(x)}\\right] = \\frac{f'(x)g(x) - f(x)g'(x)}{g(x)^2}" },
  { id: "calculus-chain-rule", domain: "calculus", name: "Chain rule", latex: "\\frac{d}{dx}f(g(x)) = f'(g(x))\\,g'(x)" },
  { id: "calculus-ftc", domain: "calculus", name: "Fundamental theorem of calculus", latex: "\\int_a^b f'(x)\\,dx = f(b) - f(a)" },
  { id: "calculus-power-rule-integral", domain: "calculus", name: "Power rule (integral)", latex: "\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C" },
  { id: "calculus-derivative-exp", domain: "calculus", name: "Derivative of eˣ", latex: "\\frac{d}{dx}e^x = e^x" },
  { id: "calculus-derivative-ln", domain: "calculus", name: "Derivative of ln(x)", latex: "\\frac{d}{dx}\\ln x = \\frac{1}{x}" },
  { id: "calculus-derivative-def", domain: "calculus", name: "Definition of the derivative", latex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}" },
  { id: "calculus-taylor-series", domain: "calculus", name: "Taylor series", latex: "f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n" },

  // Physics
  { id: "physics-kinematics-v", domain: "physics", name: "Kinematics: velocity", latex: "v = u + at" },
  { id: "physics-kinematics-s", domain: "physics", name: "Kinematics: displacement", latex: "s = ut + \\frac{1}{2}at^2" },
  { id: "physics-kinematics-v2", domain: "physics", name: "Kinematics: velocity²", latex: "v^2 = u^2 + 2as" },
  { id: "physics-newton-second", domain: "physics", name: "Newton's second law", latex: "F = ma" },
  { id: "physics-kinetic-energy", domain: "physics", name: "Kinetic energy", latex: "E_k = \\frac{1}{2}mv^2" },
  { id: "physics-potential-energy", domain: "physics", name: "Gravitational potential energy", latex: "E_p = mgh" },
  { id: "physics-ohms-law", domain: "physics", name: "Ohm's law", latex: "V = IR" },
  { id: "physics-power", domain: "physics", name: "Power", latex: "P = \\frac{W}{t}" },
  { id: "physics-gravitation", domain: "physics", name: "Newton's law of gravitation", latex: "F = G\\frac{m_1 m_2}{r^2}" },
  { id: "physics-momentum", domain: "physics", name: "Momentum", latex: "p = mv" },
  { id: "physics-wave-equation", domain: "physics", name: "Wave equation", latex: "v = f\\lambda" },
  { id: "physics-mass-energy", domain: "physics", name: "Mass-energy equivalence", latex: "E = mc^2" },

  // Chemistry (needs the mhchem KaTeX extension - see this file's own doc comment)
  { id: "chemistry-ideal-gas", domain: "chemistry", name: "Ideal gas law", latex: "PV = nRT" },
  { id: "chemistry-molarity", domain: "chemistry", name: "Molarity", latex: "M = \\frac{n}{V}" },
  { id: "chemistry-ph", domain: "chemistry", name: "pH", latex: "\\text{pH} = -\\log_{10}[\\text{H}^+]" },
  { id: "chemistry-density", domain: "chemistry", name: "Density", latex: "\\rho = \\frac{m}{V}" },
  { id: "chemistry-combined-gas-law", domain: "chemistry", name: "Combined gas law", latex: "\\frac{P_1 V_1}{T_1} = \\frac{P_2 V_2}{T_2}" },
  { id: "chemistry-percent-yield", domain: "chemistry", name: "Percent yield", latex: "\\%\\,\\text{yield} = \\frac{\\text{actual}}{\\text{theoretical}} \\times 100\\%" },
  { id: "chemistry-water-formation", domain: "chemistry", name: "Combustion: hydrogen + oxygen", latex: "\\ce{2 H2 + O2 -> 2 H2O}" },

  // Statistics
  { id: "statistics-mean", domain: "statistics", name: "Mean", latex: "\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i" },
  { id: "statistics-variance", domain: "statistics", name: "Variance", latex: "\\sigma^2 = \\frac{1}{n}\\sum_{i=1}^{n}(x_i - \\bar{x})^2" },
  { id: "statistics-std-dev", domain: "statistics", name: "Standard deviation", latex: "\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i - \\bar{x})^2}" },
  { id: "statistics-normal-pdf", domain: "statistics", name: "Normal distribution", latex: "f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\, e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}" },
  { id: "statistics-z-score", domain: "statistics", name: "Z-score", latex: "z = \\frac{x - \\mu}{\\sigma}" },
  { id: "statistics-binomial-probability", domain: "statistics", name: "Binomial probability", latex: "P(X=k) = \\binom{n}{k} p^k (1-p)^{n-k}" },
] as const;
