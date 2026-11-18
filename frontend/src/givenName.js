// The name a person is called by. Some staff are saved with the family name first ("Vaddypally Monika"), so those words are skipped.
const FAMILY_FIRST = ["vaddypally"];
export function givenName(name = "") {
  const words = String(name).replace(/^\s*dr\.?\s*/i, "").split(/\s+/).filter(Boolean);
  const rest = words.filter((w) => !FAMILY_FIRST.includes(w.toLowerCase()));
  return (rest[0] || words[0] || "");
}
