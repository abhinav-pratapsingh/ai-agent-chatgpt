const subjectLines = [
  "Quick improvement idea for your website",
  "Small suggestion after reviewing your business",
  "Website improvement opportunity",
  "Idea to improve your online visibility",
  "Performance improvement suggestion"
];

const hashString = (value) => {
  return Array.from(String(value ?? "")).reduce((total, character) => {
    return (total * 31 + character.charCodeAt(0)) >>> 0;
  }, 7);
};

const getSubjectLine = (lead = {}, variantSeed = new Date().toISOString().slice(0, 10)) => {
  const compositeSeed = [
    lead._id?.toString?.() ?? "",
    lead.name ?? "",
    lead.email ?? "",
    lead.city ?? "",
    variantSeed
  ].join("|");

  return subjectLines[hashString(compositeSeed) % subjectLines.length];
};

export { getSubjectLine, hashString, subjectLines };
