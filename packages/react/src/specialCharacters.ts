/**
 * Special character picker data (Direction B scope, per the owner-approved
 * proposal - see the "Formula Library & Special Character Picker" scoping
 * artifact): six categories, ~200 characters total. Unlike the formula
 * library, this set is drawn from standardized Unicode blocks, so "cover
 * this category" is a genuinely completable goal, not an open-ended one.
 *
 * Every entry inserts as plain text (see `insertSpecialCharacter` in
 * CanonicalAuthorityEditor.tsx) - special characters are ordinary
 * characters, never schema-level atoms.
 */

export type SpecialCharacterCategory = "greek" | "operators" | "arrows" | "currency" | "punctuation" | "accented";

export interface SpecialCharacterEntry {
  readonly char: string;
  readonly name: string;
  readonly category: SpecialCharacterCategory;
}

export const SPECIAL_CHARACTER_CATEGORIES: readonly { readonly id: SpecialCharacterCategory; readonly label: string }[] = [
  { id: "greek", label: "Greek" },
  { id: "operators", label: "Operators" },
  { id: "arrows", label: "Arrows" },
  { id: "currency", label: "Currency" },
  { id: "punctuation", label: "Punctuation" },
  { id: "accented", label: "Accented" },
];

const greekLower: readonly [string, string][] = [
  ["α", "alpha"], ["β", "beta"], ["γ", "gamma"], ["δ", "delta"], ["ε", "epsilon"], ["ζ", "zeta"],
  ["η", "eta"], ["θ", "theta"], ["ι", "iota"], ["κ", "kappa"], ["λ", "lambda"], ["μ", "mu"],
  ["ν", "nu"], ["ξ", "xi"], ["ο", "omicron"], ["π", "pi"], ["ρ", "rho"], ["σ", "sigma"],
  ["τ", "tau"], ["υ", "upsilon"], ["φ", "phi"], ["χ", "chi"], ["ψ", "psi"], ["ω", "omega"],
];
const greekUpper: readonly [string, string][] = [
  ["Α", "Alpha"], ["Β", "Beta"], ["Γ", "Gamma"], ["Δ", "Delta"], ["Ε", "Epsilon"], ["Ζ", "Zeta"],
  ["Η", "Eta"], ["Θ", "Theta"], ["Ι", "Iota"], ["Κ", "Kappa"], ["Λ", "Lambda"], ["Μ", "Mu"],
  ["Ν", "Nu"], ["Ξ", "Xi"], ["Ο", "Omicron"], ["Π", "Pi"], ["Ρ", "Rho"], ["Σ", "Sigma"],
  ["Τ", "Tau"], ["Υ", "Upsilon"], ["Φ", "Phi"], ["Χ", "Chi"], ["Ψ", "Psi"], ["Ω", "Omega"],
];

const operators: readonly [string, string][] = [
  ["±", "plus-minus"], ["∓", "minus-plus"], ["×", "multiplication"], ["÷", "division"], ["⋅", "dot"],
  ["≈", "approximately equal"], ["≠", "not equal"], ["≡", "identical to"], ["≤", "less than or equal"],
  ["≥", "greater than or equal"], ["≪", "much less than"], ["≫", "much greater than"], ["∞", "infinity"],
  ["√", "square root"], ["∛", "cube root"], ["∑", "summation"], ["∏", "product"], ["∫", "integral"],
  ["∬", "double integral"], ["∮", "contour integral"], ["∂", "partial derivative"], ["∇", "nabla"],
  ["∆", "delta (increment)"], ["∈", "element of"], ["∉", "not an element of"], ["⊂", "subset of"],
  ["⊃", "superset of"], ["⊆", "subset or equal"], ["⊇", "superset or equal"], ["∪", "union"],
  ["∩", "intersection"], ["∅", "empty set"], ["∀", "for all"], ["∃", "there exists"], ["¬", "not"],
  ["∧", "logical and"], ["∨", "logical or"], ["⊕", "circled plus"], ["⊗", "circled times"],
  ["∝", "proportional to"], ["∥", "parallel to"], ["⊥", "perpendicular to"], ["°", "degree"],
  ["′", "prime"], ["″", "double prime"], ["ℏ", "reduced Planck constant"],
];

const arrows: readonly [string, string][] = [
  ["←", "left arrow"], ["↑", "up arrow"], ["→", "right arrow"], ["↓", "down arrow"],
  ["↔", "left-right arrow"], ["↕", "up-down arrow"], ["↖", "up-left arrow"], ["↗", "up-right arrow"],
  ["↘", "down-right arrow"], ["↙", "down-left arrow"], ["⇐", "left double arrow"], ["⇑", "up double arrow"],
  ["⇒", "right double arrow"], ["⇓", "down double arrow"], ["⇔", "left-right double arrow"],
  ["⇕", "up-down double arrow"], ["⇌", "equilibrium arrows"], ["⇋", "reverse equilibrium arrows"],
  ["↦", "maps to"], ["↩", "hook left arrow"], ["↪", "hook right arrow"], ["⤴", "arrow curving up"],
  ["⤵", "arrow curving down"], ["⇢", "dashed right arrow"], ["⇠", "dashed left arrow"],
];

const currency: readonly [string, string][] = [
  ["$", "dollar sign"], ["¢", "cent sign"], ["£", "pound sign"], ["¤", "generic currency sign"],
  ["¥", "yen sign"], ["€", "euro sign"], ["₹", "rupee sign"], ["₩", "won sign"], ["₽", "ruble sign"],
  ["₺", "lira sign"], ["₴", "hryvnia sign"], ["₫", "dong sign"], ["₦", "naira sign"], ["฿", "baht sign"],
  ["₱", "peso sign"],
];

const punctuation: readonly [string, string][] = [
  ["–", "en dash"], ["—", "em dash"], ["…", "ellipsis"], ["“", "left double quote"], ["”", "right double quote"],
  ["‘", "left single quote"], ["’", "right single quote"], ["„", "low double quote"], ["«", "left guillemet"],
  ["»", "right guillemet"], ["§", "section sign"], ["¶", "pilcrow"], ["©", "copyright"], ["®", "registered trademark"],
  ["™", "trademark"], ["†", "dagger"], ["‡", "double dagger"], ["•", "bullet"], ["‰", "per mille"], ["¦", "broken bar"],
];

const accented: readonly [string, string][] = [
  ["à", "a grave"], ["á", "a acute"], ["â", "a circumflex"], ["ã", "a tilde"], ["ä", "a diaeresis"], ["å", "a ring"],
  ["æ", "ae ligature"], ["ç", "c cedilla"], ["è", "e grave"], ["é", "e acute"], ["ê", "e circumflex"], ["ë", "e diaeresis"],
  ["ì", "i grave"], ["í", "i acute"], ["î", "i circumflex"], ["ï", "i diaeresis"], ["ñ", "n tilde"], ["ò", "o grave"],
  ["ó", "o acute"], ["ô", "o circumflex"], ["õ", "o tilde"], ["ö", "o diaeresis"], ["ø", "o stroke"], ["ù", "u grave"],
  ["ú", "u acute"], ["û", "u circumflex"], ["ü", "u diaeresis"], ["ý", "y acute"], ["ÿ", "y diaeresis"], ["ß", "sharp s"],
  ["À", "A grave"], ["Á", "A acute"], ["Â", "A circumflex"], ["Ã", "A tilde"], ["Ä", "A diaeresis"], ["Å", "A ring"],
  ["Æ", "AE ligature"], ["Ç", "C cedilla"], ["È", "E grave"], ["É", "E acute"], ["Ê", "E circumflex"], ["Ë", "E diaeresis"],
  ["Ì", "I grave"], ["Í", "I acute"], ["Ñ", "N tilde"], ["Ò", "O grave"], ["Ó", "O acute"], ["Ö", "O diaeresis"],
  ["Ù", "U grave"], ["Ü", "U diaeresis"],
];

const toEntries = (pairs: readonly [string, string][], category: SpecialCharacterCategory): SpecialCharacterEntry[] =>
  pairs.map(([char, name]) => ({ char, name, category }));

export const SPECIAL_CHARACTERS: readonly SpecialCharacterEntry[] = [
  ...toEntries(greekLower, "greek"),
  ...toEntries(greekUpper, "greek"),
  ...toEntries(operators, "operators"),
  ...toEntries(arrows, "arrows"),
  ...toEntries(currency, "currency"),
  ...toEntries(punctuation, "punctuation"),
  ...toEntries(accented, "accented"),
];
