const supportedCountries = [
  {
    name: "USA",
    code: "US",
    timezones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
    cityTimezones: {
      "new york": "America/New_York",
      "los angeles": "America/Los_Angeles",
      chicago: "America/Chicago",
      houston: "America/Chicago",
      phoenix: "America/Phoenix",
      philadelphia: "America/New_York",
      "san antonio": "America/Chicago",
      "san diego": "America/Los_Angeles",
      dallas: "America/Chicago",
      austin: "America/Chicago",
      jacksonville: "America/New_York",
      "san jose": "America/Los_Angeles",
      "fort worth": "America/Chicago",
      columbus: "America/New_York",
      charlotte: "America/New_York",
      indianapolis: "America/Indiana/Indianapolis",
      seattle: "America/Los_Angeles",
      denver: "America/Denver",
      boston: "America/New_York",
      miami: "America/New_York",
      atlanta: "America/New_York",
      "las vegas": "America/Los_Angeles"
    }
  },
  {
    name: "Canada",
    code: "CA",
    timezones: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver"],
    cityTimezones: {
      toronto: "America/Toronto",
      ottawa: "America/Toronto",
      montreal: "America/Toronto",
      mississauga: "America/Toronto",
      brampton: "America/Toronto",
      vancouver: "America/Vancouver",
      surrey: "America/Vancouver",
      burnaby: "America/Vancouver",
      calgary: "America/Edmonton",
      edmonton: "America/Edmonton",
      winnipeg: "America/Winnipeg",
      halifax: "America/Halifax",
      stjohns: "America/St_Johns",
      "st. john's": "America/St_Johns"
    }
  },
  {
    name: "UK",
    code: "GB",
    timezones: ["Europe/London"],
    cityTimezones: {
      london: "Europe/London",
      manchester: "Europe/London",
      birmingham: "Europe/London",
      leeds: "Europe/London",
      glasgow: "Europe/London",
      liverpool: "Europe/London",
      bristol: "Europe/London",
      edinburgh: "Europe/London"
    }
  },
  {
    name: "Australia",
    code: "AU",
    timezones: ["Australia/Sydney", "Australia/Perth"],
    cityTimezones: {
      sydney: "Australia/Sydney",
      melbourne: "Australia/Melbourne",
      brisbane: "Australia/Brisbane",
      perth: "Australia/Perth",
      adelaide: "Australia/Adelaide",
      canberra: "Australia/Sydney",
      hobart: "Australia/Hobart",
      darwin: "Australia/Darwin"
    }
  },
  {
    name: "New Zealand",
    code: "NZ",
    timezones: ["Pacific/Auckland"],
    cityTimezones: {
      auckland: "Pacific/Auckland",
      wellington: "Pacific/Auckland",
      christchurch: "Pacific/Auckland"
    }
  },
  {
    name: "Ireland",
    code: "IE",
    timezones: ["Europe/Dublin"],
    cityTimezones: {
      dublin: "Europe/Dublin",
      cork: "Europe/Dublin",
      galway: "Europe/Dublin"
    }
  },
  {
    name: "Singapore",
    code: "SG",
    timezones: ["Asia/Singapore"],
    cityTimezones: {
      singapore: "Asia/Singapore"
    }
  },
  {
    name: "UAE",
    code: "AE",
    timezones: ["Asia/Dubai"],
    cityTimezones: {
      dubai: "Asia/Dubai",
      "abu dhabi": "Asia/Dubai",
      sharjah: "Asia/Dubai"
    }
  }
];

const normalizeText = (value) => {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getRotatedCountry = (date = new Date()) => {
  const baseUtcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayIndex = Math.floor(baseUtcMidnight / 86400000);
  return supportedCountries[((dayIndex % supportedCountries.length) + supportedCountries.length) % supportedCountries.length];
};

const isAllowedCountry = (countryName) => {
  return supportedCountries.some((country) => country.name.toLowerCase() === String(countryName ?? "").toLowerCase());
};

const getCountryByName = (countryName) => {
  return supportedCountries.find((country) => country.name.toLowerCase() === String(countryName ?? "").toLowerCase());
};

const inferTimezone = (countryName, cityName) => {
  const matchedCountry = getCountryByName(countryName);

  if (!matchedCountry) {
    return "UTC";
  }

  const normalizedCity = normalizeText(cityName);
  const matchedCityKey = Object.keys(matchedCountry.cityTimezones ?? {}).find((cityKey) => normalizedCity.includes(normalizeText(cityKey)));
  return matchedCityKey ? matchedCountry.cityTimezones[matchedCityKey] : matchedCountry.timezones?.[0] ?? "UTC";
};

const getCountryTimezone = (countryName) => {
  return inferTimezone(countryName, "");
};

export { getCountryByName, getCountryTimezone, getRotatedCountry, inferTimezone, isAllowedCountry, supportedCountries };


