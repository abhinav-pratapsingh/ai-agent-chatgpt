const ACTIVE_TIER = Number.parseInt(process.env.ACTIVE_TIER ?? "1", 10);

const tierDefinitions = {
  1: {
    name: "Small Businesses",
    industries: [
      "dentists",
      "restaurants",
      "cafes",
      "salons",
      "barbershops",
      "gyms",
      "yoga studios",
      "cleaning services",
      "plumbers",
      "electricians",
      "car detailing services",
      "dance studios",
      "pet grooming services",
      "photographers",
      "laundry services",
      "tailoring shops"
    ]
  },
  2: {
    name: "Growing Businesses",
    industries: [
      "real estate agents",
      "property managers",
      "travel agencies",
      "interior designers",
      "architect firms",
      "coaching institutes",
      "daycare centers",
      "fitness studios",
      "medical labs",
      "chiropractors",
      "physiotherapy clinics",
      "vet clinics",
      "beauty clinics",
      "spa centers",
      "wedding planners"
    ]
  },
  3: {
    name: "Service Companies",
    industries: [
      "roofing companies",
      "HVAC companies",
      "solar installation companies",
      "construction companies",
      "home renovation companies",
      "landscaping companies",
      "moving companies",
      "pest control companies",
      "security system installers",
      "window replacement companies",
      "garage door companies",
      "painting contractors"
    ]
  },
  4: {
    name: "Premium Clinics",
    industries: [
      "cosmetic clinics",
      "dental implant clinics",
      "orthodontists",
      "skin clinics",
      "laser treatment clinics",
      "rehabilitation centers",
      "nutrition clinics",
      "sports therapy centers",
      "mental wellness clinics"
    ]
  },
  5: {
    name: "Multi-location Businesses",
    industries: [
      "restaurant chains",
      "gym franchises",
      "salon chains",
      "cleaning franchises",
      "retail store chains",
      "optical stores",
      "auto service centers"
    ]
  }
};

const getActiveTier = () => {
  return tierDefinitions[ACTIVE_TIER] ? ACTIVE_TIER : 1;
};

const getActiveIndustries = () => {
  return tierDefinitions[getActiveTier()].industries;
};

const getTierMetadata = () => {
  const tierId = getActiveTier();
  return {
    tierId,
    ...tierDefinitions[tierId]
  };
};

export { ACTIVE_TIER, getActiveIndustries, getActiveTier, getTierMetadata, tierDefinitions };
