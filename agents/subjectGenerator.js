const subjectLines = [
  "Quick improvement idea for your website",
  "Small suggestion after reviewing your business",
  "Website improvement opportunity",
  "Idea to improve your online visibility",
  "Performance improvement suggestion"
];

const getSubjectLine = (seedValue = Date.now()) => {
  const normalizedSeed = Math.abs(Number(seedValue) || 0);
  return subjectLines[normalizedSeed % subjectLines.length];
};

export { getSubjectLine, subjectLines };
