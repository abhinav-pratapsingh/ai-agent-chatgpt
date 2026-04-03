const supportedCountries = [
  { name: "USA", code: "US", timezones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"] },
  { name: "Canada", code: "CA", timezones: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver"] },
  { name: "UK", code: "GB", timezones: ["Europe/London"] },
  { name: "Australia", code: "AU", timezones: ["Australia/Sydney", "Australia/Perth"] },
  { name: "New Zealand", code: "NZ", timezones: ["Pacific/Auckland"] },
  { name: "Ireland", code: "IE", timezones: ["Europe/Dublin"] },
  { name: "Singapore", code: "SG", timezones: ["Asia/Singapore"] },
  { name: "UAE", code: "AE", timezones: ["Asia/Dubai"] }
];

const getRotatedCountry = (date = new Date()) => {
  const baseUtcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayIndex = Math.floor(baseUtcMidnight / 86400000);
  return supportedCountries[((dayIndex % supportedCountries.length) + supportedCountries.length) % supportedCountries.length];
};

const isAllowedCountry = (countryName) => {
  return supportedCountries.some((country) => country.name.toLowerCase() === String(countryName ?? "").toLowerCase());
};

const getCountryTimezone = (countryName) => {
  const matchedCountry = supportedCountries.find((country) => country.name.toLowerCase() === String(countryName ?? "").toLowerCase());
  return matchedCountry?.timezones?.[0] ?? "UTC";
};

export { getCountryTimezone, getRotatedCountry, isAllowedCountry, supportedCountries };
