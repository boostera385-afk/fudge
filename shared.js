const Fudge = (() => {
  const SERVICES = [
    {
      id: "drywall", label: "Drywall", color: "#ff8e72", searchTerm: "drywall repair",
      terms: ["drywall", "sheetrock", "plaster", "wall repair", "ceiling repair", "hole in the wall", "patching"],
      subcategories: [
        { id: "patch-repair", label: "Patch & hole repair", terms: ["drywall patch", "patched", "patching", "hole in the wall", "wall hole", "nail hole", "damaged wall", "fixed wall", "repaired wall", "wall looks new"] },
        { id: "ceiling-repair", label: "Ceiling repair", terms: ["ceiling repair", "ceiling hole", "ceiling crack", "sagging ceiling"] },
        { id: "water-damage", label: "Water-damage repair", terms: ["water damage", "water damaged", "moisture damage", "leak damage"] },
        { id: "texture-matching", label: "Texture matching", terms: ["texture match", "texture matching", "matched texture", "matched the texture", "popcorn ceiling", "orange peel", "orange peel texture", "knockdown texture"] },
        { id: "drywall-installation", label: "Drywall installation", terms: ["drywall installation", "installed drywall", "hung drywall", "new sheetrock"] },
        { id: "drywall-general", label: "General drywall work", terms: [] }
      ]
    },
    {
      id: "painting", label: "Painting", color: "#cf82ff", searchTerm: "painting services",
      terms: ["paint", "painted", "painting", "painter", "repainted", "touch up", "touched up", "color match", "matched the color", "accent wall", "cabinet refinishing", "stain", "stained"],
      subcategories: [
        { id: "interior-painting", label: "Interior painting", terms: ["interior painting", "painted the room", "bedroom paint", "living room paint", "inside the house"] },
        { id: "exterior-painting", label: "Exterior painting", terms: ["exterior painting", "exterior house painting", "painted the exterior", "painted outside", "painted the outside", "outside paint", "outside of the house", "house exterior", "exterior walls", "painted the siding", "siding paint"] },
        { id: "cabinet-painting", label: "Cabinet painting", terms: ["cabinet painting", "painted cabinets", "cabinet refinishing", "refinished cabinets"] },
        { id: "trim-painting", label: "Trim & detail painting", terms: ["trim painting", "painted trim", "baseboard paint", "crown molding paint", "accent wall"] },
        { id: "staining", label: "Staining & finishing", terms: ["wood stain", "staining", "stained the", "refinishing"] },
        { id: "painting-general", label: "General painting", terms: [] }
      ]
    },
    {
      id: "flooring", label: "Flooring", color: "#ffbd59", searchTerm: "flooring services",
      terms: ["floor", "floors", "flooring", "hardwood", "laminate", "vinyl", "tile", "carpet", "subfloor"],
      subcategories: [
        { id: "hardwood-flooring", label: "Hardwood flooring", terms: ["hardwood", "wood floor", "floor refinishing", "refinished the floor"] },
        { id: "laminate-flooring", label: "Laminate flooring", terms: ["laminate floor", "laminate flooring"] },
        { id: "vinyl-flooring", label: "Vinyl & LVP flooring", terms: ["vinyl floor", "vinyl plank", "luxury vinyl", "lvp"] },
        { id: "tile-flooring", label: "Tile flooring", terms: ["tile floor", "floor tile", "grout"] },
        { id: "carpet", label: "Carpet", terms: ["carpet", "carpeting"] },
        { id: "flooring-installation", label: "Flooring installation", terms: ["flooring installation", "floor installation", "installed the flooring", "installed new flooring", "new floor installation", "laid the floor"] },
        { id: "subfloor-repair", label: "Subfloor repair", terms: ["subfloor", "floor joist", "squeaky floor", "floor repair"] },
        { id: "flooring-general", label: "General flooring", terms: [] }
      ]
    },
    {
      id: "garage-doors", label: "Garage doors", color: "#ff9f5a", searchTerm: "garage door repair services",
      terms: ["garage door", "door opener", "torsion spring", "garage spring", "wayne dalton", "garage track", "overhead door"],
      subcategories: [
        { id: "track-repair", label: "Track & roller repair", terms: ["garage door track", "door track", "off track", "tracks", "track repair", "track alignment", "aligned the track", "aligned the tracks", "realigned", "rail", "rails", "off the rail", "roller", "rollers"] },
        { id: "spring-repair", label: "Spring replacement", terms: ["torsion spring", "extension spring", "garage spring", "broken spring", "spring replacement", "replaced the spring", "spring repair"] },
        { id: "opener-repair", label: "Opener & motor repair", terms: ["garage door opener", "door opener", "opener repair", "opener motor", "motor", "remote", "keypad", "sensor"] },
        { id: "cable-repair", label: "Cable & drum repair", terms: ["garage cable", "door cable", "broken cable", "cable repair", "cable replacement", "cable drum"] },
        { id: "panel-repair", label: "Panel repair", terms: ["garage door panel", "door panel", "damaged panel", "panel replacement", "door section"] },
        { id: "garage-installation", label: "Garage door installation", terms: ["garage door installation", "garage door install", "installation of a garage door", "installed a garage door", "installed the garage door", "put in a garage door", "brand new garage door", "new garage door", "garage door replacement", "replaced the garage door"] },
        { id: "garage-maintenance", label: "Tune-up & maintenance", terms: ["garage door tune up", "garage maintenance", "lubed the tracks", "lubricated", "tune up"] },
        { id: "garage-general", label: "General garage door repair", terms: [] }
      ]
    },
    {
      id: "installation", label: "Installation", color: "#78c7ff", generic: true, searchTerm: "handyman services",
      terms: ["install", "installed", "installation", "mounted", "assembly", "assembled", "fixture", "shelving", "door", "window"],
      subcategories: [
        { id: "door-window-installation", label: "Door & window installation", terms: ["door installation", "installed a door", "window installation", "installed a window", "door replacement", "window replacement"] },
        { id: "fixture-installation", label: "Fixture installation", terms: ["fixture installation", "installed the fixture", "bath fixture", "hardware installation"] },
        { id: "tv-mounting", label: "TV mounting", terms: ["tv mount", "tv mounting", "mounted the tv", "television mount", "installed the tv"] },
        { id: "picture-hanging", label: "Picture & frame hanging", terms: ["picture hanging", "frame hanging", "hung pictures", "hung frames", "wall art hanging", "gallery wall"] },
        { id: "mounting-shelving", label: "Mounting & shelving", terms: ["mounted", "wall mount", "tv mount", "shelving", "installed shelves", "hung the"] },
        { id: "furniture-assembly", label: "Furniture assembly", terms: ["furniture assembly", "assemble", "assembled", "assembling", "assembly service", "put together", "flat pack", "flatpack", "ikea", "wardrobe", "dresser", "bed", "bed frame", "bedframe", "bunk bed", "bunkbed", "crib", "cot", "table", "dining table", "dinning table", "desk", "chair", "office chair", "shelf", "shelves", "shelving", "bookshelf", "bookcase", "drawer", "drawers", "chest of drawers", "nightstand", "armoire", "cabinet", "cabinets", "vanity", "patio furniture", "office furniture", "entertainment center", "entertainment unit", "storage unit"] },
        { id: "installation-general", label: "General installation", terms: [] }
      ]
    },
    {
      id: "plumbing", label: "Plumbing", color: "#62d9cd", searchTerm: "plumbing services",
      terms: ["plumb", "plumber", "plumbing", "faucet", "sink", "toilet", "pipe", "drain", "leak", "water heater"],
      subcategories: [
        { id: "leak-pipe-repair", label: "Leak & pipe repair", terms: ["pipe leak", "leaking pipe", "burst pipe", "pipe repair", "water leak", "fixed the leak"] },
        { id: "drain-service", label: "Drain service", terms: ["clogged drain", "drain cleaning", "drain repair", "sewer line", "unclogged"] },
        { id: "toilet-repair", label: "Toilet repair", terms: ["toilet repair", "fixed the toilet", "toilet installation", "installed a toilet", "toilet replacement", "replaced the toilet", "new toilet", "toilet"] },
        { id: "faucet-sink", label: "Faucet & sink", terms: ["faucet", "sink repair", "sink installation", "garbage disposal"] },
        { id: "water-heater", label: "Water heater", terms: ["water heater", "tankless heater", "hot water"] },
        { id: "plumbing-general", label: "General plumbing", terms: [] }
      ]
    },
    {
      id: "electrical", label: "Electrical", color: "#e7ef42", searchTerm: "electrical services",
      terms: ["electric", "electrical", "electrician", "outlet", "wiring", "breaker", "lighting", "light fixture", "ceiling fan"],
      subcategories: [
        { id: "outlets-switches", label: "Outlets & switches", terms: ["outlet", "outlets", "electrical outlet", "power outlet", "outlet repair", "receptacle", "receptable", "gfci", "duplex outlet", "tamper resistant", "plug", "plug socket", "light switch", "dimmer switch"] },
        { id: "panel-breaker", label: "Panel & breaker", terms: ["electrical panel", "breaker panel", "circuit breaker", "tripped breaker", "panel upgrade"] },
        { id: "lighting", label: "Lighting installation", terms: ["light fixture", "lighting installation", "installed lights", "recessed lighting", "chandelier"] },
        { id: "ceiling-fan", label: "Ceiling fan", terms: ["ceiling fan", "fan installation"] },
        { id: "wiring", label: "Wiring repair", terms: ["electrical wiring", "rewire", "wiring repair", "faulty wiring"] },
        { id: "electrical-general", label: "General electrical", terms: [] }
      ]
    },
    {
      id: "holiday-lighting", label: "Holiday lighting", color: "#ef5b78", searchTerm: "christmas light installation",
      terms: ["christmas lights", "christmas lighting", "holiday lights", "holiday lighting", "seasonal lights", "govee lights", "permanent lights"],
      subcategories: [
        { id: "christmas-lights-installation", label: "Christmas lights installation", terms: ["christmas lights installation", "installed christmas lights", "holiday light installation", "installed holiday lights", "govee light installation", "permanent light installation", "christmas lights", "holiday lights", "govee lights", "permanent lights", "roofline lights", "holiday display", "seasonal display"] },
        { id: "holiday-light-removal", label: "Holiday light removal", terms: ["christmas light removal", "holiday light removal", "removed the lights"] },
        { id: "holiday-lighting-general", label: "General holiday lighting", terms: [] }
      ]
    },
    {
      id: "junk-removal", label: "Junk removal", color: "#65c7a5", searchTerm: "junk removal services",
      terms: ["junk removal", "junk hauling", "haul away", "hauled away", "cleanout", "clearout", "trash removal", "debris removal", "mattress removal", "matress removal", "waste removal", "rubbish removal", "clutter removal", "dumpster service", "junk pickup", "trash pickup"],
      subcategories: [
        { id: "junk-hauling", label: "Junk hauling", terms: ["junk removal", "junk hauling", "hauled away", "haul away", "mattress removal", "matress removal", "waste removal", "rubbish removal", "trash pickup", "junk pickup"] },
        { id: "property-cleanout", label: "Property cleanout", terms: ["property cleanout", "garage cleanout", "estate cleanout", "house cleanout"] },
        { id: "debris-removal", label: "Debris removal", terms: ["debris removal", "construction debris", "yard debris"] },
        { id: "junk-removal-general", label: "General junk removal", terms: [] }
      ]
    },
    {
      id: "roofing", label: "Roofing", color: "#a5cf6d", searchTerm: "roofing services",
      terms: ["roof", "roofing", "shingle", "gutter", "flashing", "soffit", "fascia"],
      subcategories: [
        { id: "roof-leak", label: "Roof leak repair", terms: ["roof leak", "leaking roof", "leak repair", "roof repair"] },
        { id: "shingles", label: "Shingle repair", terms: ["shingle", "missing shingles", "replaced shingles"] },
        { id: "gutters", label: "Gutters", terms: ["gutter", "downspout"] },
        { id: "flashing", label: "Flashing repair", terms: ["roof flashing", "flashing repair", "chimney flashing"] },
        { id: "soffit-fascia", label: "Soffit & fascia", terms: ["soffit", "fascia"] },
        { id: "roofing-general", label: "General roofing", terms: [] }
      ]
    },
    {
      id: "carpentry", label: "Carpentry", color: "#c99168", searchTerm: "carpentry services",
      terms: ["carpentry", "carpenter", "woodwork", "cabinet", "framing", "deck", "fence", "trim work"],
      subcategories: [
        { id: "cabinetry", label: "Cabinetry", terms: ["custom cabinet", "cabinet repair", "cabinet installation", "built cabinets"] },
        { id: "framing", label: "Framing", terms: ["wood framing", "wall framing", "framed the"] },
        { id: "deck-repair", label: "Deck repair", terms: ["deck repair", "deck boards", "built a deck", "deck restoration"] },
        { id: "fence-repair", label: "Fence repair", terms: ["fence repair", "fence installation", "fence post", "built a fence"] },
        { id: "trim-millwork", label: "Trim & millwork", terms: ["trim work", "baseboard", "crown molding", "millwork"] },
        { id: "carpentry-general", label: "General carpentry", terms: [] }
      ]
    },
    {
      id: "remodeling", label: "Remodeling", color: "#ff779f", searchTerm: "remodeling services",
      terms: ["remodel", "remodeled", "remodeling", "renovation", "renovated", "kitchen", "bathroom", "basement", "makeover", "restoration"],
      subcategories: [
        { id: "kitchen-remodel", label: "Kitchen remodeling", terms: ["kitchen remodel", "kitchen renovation", "renovated the kitchen"] },
        { id: "bathroom-remodel", label: "Bathroom remodeling", terms: ["bathroom remodel", "bathroom renovation", "shower remodel"] },
        { id: "basement-remodel", label: "Basement remodeling", terms: ["basement remodel", "finished basement", "basement renovation"] },
        { id: "whole-home-remodel", label: "Whole-home remodeling", terms: ["whole home remodel", "full home renovation", "entire house renovation"] },
        { id: "remodeling-general", label: "General remodeling", terms: [] }
      ]
    },
    {
      id: "hvac", label: "HVAC", color: "#8faaff", searchTerm: "hvac repair services",
      terms: ["hvac", "air conditioning", "air conditioner", "furnace", "heating", "vent", "thermostat", "duct", "ac repair"],
      subcategories: [
        { id: "ac-repair", label: "AC repair", terms: ["ac repair", "air conditioning repair", "air conditioner repair", "cooling repair", "refrigerant"] },
        { id: "heating-furnace", label: "Heating & furnace", terms: ["furnace repair", "heating repair", "heater repair", "heat pump"] },
        { id: "thermostat", label: "Thermostat", terms: ["thermostat", "smart thermostat"] },
        { id: "duct-vent", label: "Duct & vent work", terms: ["air duct", "ductwork", "duct cleaning", "vent repair", "hvac vent"] },
        { id: "hvac-maintenance", label: "HVAC maintenance", terms: ["hvac maintenance", "ac maintenance", "furnace tune up", "seasonal tune up"] },
        { id: "hvac-installation", label: "HVAC installation", terms: ["hvac installation", "ac installation", "installed a furnace", "new hvac system", "system replacement"] },
        { id: "hvac-general", label: "General HVAC", terms: [] }
      ]
    },
    {
      id: "exterior", label: "Exterior", color: "#7ed888", searchTerm: "exterior services",
      terms: ["siding", "pressure wash", "power wash", "exterior", "concrete", "masonry", "stucco"],
      subcategories: [
        { id: "siding", label: "Siding repair", terms: ["siding repair", "vinyl siding", "siding installation"] },
        { id: "pressure-washing", label: "Pressure washing", terms: ["pressure wash", "power wash"] },
        { id: "concrete-masonry", label: "Concrete & masonry", terms: ["concrete repair", "masonry", "brick repair", "paver"] },
        { id: "stucco", label: "Stucco repair", terms: ["stucco repair", "stucco patch", "repaired the stucco"] },
        { id: "exterior-general", label: "General exterior work", terms: [] }
      ]
    },
    {
      id: "appliance", label: "Appliance repair", color: "#7fb2e8", searchTerm: "appliance repair", collapseToFamily: true,
      terms: ["appliance", "appliances", "washer", "washing machine", "dryer", "refrigerator", "fridge", "freezer", "dishwasher", "oven", "stove", "range", "cooktop", "microwave", "ice maker"],
      subcategories: [
        { id: "washer-dryer", label: "Washer & dryer", terms: ["washer", "washing machine", "dryer", "laundry machine", "washer repair", "dryer repair"] },
        { id: "refrigeration", label: "Refrigerator & freezer", terms: ["refrigerator", "fridge", "freezer", "ice maker", "cooling unit"] },
        { id: "dishwasher", label: "Dishwasher", terms: ["dishwasher"] },
        { id: "oven-stove", label: "Oven, stove & microwave", terms: ["oven", "stove", "range", "cooktop", "microwave", "burner"] },
        { id: "appliance-general", label: "General appliance repair", terms: [] }
      ]
    },
    {
      id: "cleaning", label: "Specialty cleaning", color: "#5fc9b8", searchTerm: "cleaning services",
      terms: ["window cleaning", "gutter cleaning", "carpet cleaning", "rug cleaning", "upholstery cleaning", "pressure washing", "power washing", "rainspout"],
      subcategories: [
        { id: "window-cleaning", label: "Window cleaning", terms: ["window cleaning", "cleaned the windows", "window washer"] },
        { id: "gutter-cleaning", label: "Gutter cleaning", terms: ["gutter cleaning", "cleaned the gutters", "rainspout", "downspout cleaning"] },
        { id: "carpet-cleaning", label: "Carpet & rug cleaning", terms: ["carpet cleaning", "rug cleaning", "cleaned the carpet", "carpeting"] },
        { id: "upholstery-cleaning", label: "Upholstery cleaning", terms: ["upholstery cleaning", "sofa cleaning", "couch cleaning", "cleaned the upholstery"] },
        { id: "pressure-washing", label: "Pressure washing", terms: ["pressure washing", "pressure washed", "power washing", "power washed"] },
        { id: "cleaning-general", label: "General specialty cleaning", terms: [] }
      ]
    },
    {
      id: "moving", label: "Moving", color: "#8aa4e8", searchTerm: "moving services",
      terms: ["moving", "movers", "mover", "relocation", "moved us", "move service"],
      subcategories: [
        { id: "local-moving", label: "Moving service", terms: ["moving company", "moving service", "movers", "mover", "moved us", "our move", "relocation"] },
        { id: "moving-general", label: "General moving", terms: [] }
      ]
    },
    {
      id: "general", label: "General repairs", color: "#c3baa9", generic: true, searchTerm: "handyman services",
      terms: ["handyman", "general repair", "home maintenance", "home improvement", "odd jobs"],
      subcategories: [
        { id: "handyman", label: "Handyman service", terms: ["handyman", "odd jobs", "honey do list"] },
        { id: "maintenance", label: "Home maintenance", terms: ["home maintenance", "property maintenance", "routine maintenance"] },
        { id: "general-repair", label: "General repair", terms: [] }
      ]
    }
  ];

  const normalize = (value = "") => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const slug = (value = "") => normalize(value).replace(/\s+/g, "-") || "custom-service";
  const ruleList = (value) => Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "").split(/[|;\n]+/).map((item) => item.trim()).filter(Boolean);
  let SERVICE_RULES = [];
  const serviceRuleFor = (keyword) => SERVICE_RULES.find((rule) => normalize(rule.keyword) === normalize(keyword)) || null;
  const setServiceRules = (rules = []) => {
    SERVICE_RULES = (Array.isArray(rules) ? rules : []).map((source) => ({
      keyword: String(source.keyword || "").trim(),
      searchTerm: String(source.searchTerm || "").trim(),
      businessSignals: ruleList(source.businessSignals),
      reviewSignals: ruleList(source.reviewSignals),
      requiredSignals: ruleList(source.requiredSignals),
      topicSignals: ruleList(source.topicSignals),
      excludeSignals: ruleList(source.excludeSignals),
      family: String(source.family || source.keyword || "").trim(),
      subcategory: String(source.subcategory || source.keyword || "").trim(),
      topicRequired: Boolean(source.topicRequired),
      collectFamilyInventory: Boolean(source.collectFamilyInventory),
      rewriteServicePhrase: String(source.rewriteServicePhrase || source.keyword || "").trim(),
      equivalentServicePhrases: ruleList(source.equivalentServicePhrases)
    })).filter((rule) => rule.keyword);
    // Unknown services still appear in the dashboard. Built-in services keep their
    // established display groups while Sheet-only services receive a simple group.
    for (let index = SERVICES.length - 1; index >= 0; index -= 1) {
      if (SERVICES[index].sheetManaged) SERVICES.splice(index, 1);
    }
    SERVICES.forEach((service) => {
      service.subcategories = service.subcategories.filter((subcategory) => !subcategory.sheetManaged);
    });
    const palette = ["#78c7ff", "#65c7a5", "#cf82ff", "#ffbd59", "#8faaff", "#ff8e72"];
    SERVICE_RULES.forEach((rule, index) => {
      const familyMatch = SERVICES.find((service) => normalize(service.id) === normalize(rule.family) || normalize(service.label) === normalize(rule.family));
      if (familyMatch) {
        const hasSubcategory = familyMatch.subcategories.some((item) => normalize(item.id) === normalize(rule.subcategory) || normalize(item.label) === normalize(rule.subcategory));
        if (!hasSubcategory) {
          const configured = { id: slug(rule.subcategory), label: rule.subcategory, terms: [...new Set([rule.keyword, ...rule.reviewSignals, ...rule.requiredSignals])], sheetManaged: true };
          const catchAllIndex = familyMatch.subcategories.findIndex((item) => isGeneralSubcategory(item.id));
          if (catchAllIndex >= 0) familyMatch.subcategories.splice(catchAllIndex, 0, configured);
          else familyMatch.subcategories.push(configured);
        }
        return;
      }
      const id = slug(rule.family);
      if (SERVICES.some((service) => service.id === id)) return;
      SERVICES.push({
        id,
        label: rule.family,
        color: palette[index % palette.length],
        searchTerm: rule.searchTerm || rule.keyword,
        terms: [...new Set([rule.keyword, ...rule.reviewSignals, ...rule.requiredSignals])],
        subcategories: [{ id: slug(rule.subcategory), label: rule.subcategory, terms: [...new Set([rule.keyword, ...rule.reviewSignals, ...rule.requiredSignals])] }],
        sheetManaged: true
      });
    });
    return SERVICE_RULES;
  };
  // Every Drive link Fudge writes to the Sheet takes one shape: the sharing link
  // people recognise and can open. Google hands back several others — uc?export,
  // open?id, the SDK's own /view?usp=drivesdk — and the raw googleusercontent URL
  // the picture was scraped from is not a Drive link at all.
  const driveFileId = (value = "") => {
    const text = String(value || "").trim();
    const match = text.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/)
      || text.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
      || text.match(/\/d\/([A-Za-z0-9_-]{10,})/);
    if (match) return match[1];
    return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : "";
  };
  const driveShareLink = (value = "") => {
    const id = driveFileId(value);
    return id ? `https://drive.google.com/file/d/${id}/view?usp=sharing` : "";
  };
  const originalPhotoUrl = (value = "") => {
    if (!value) return "";
    return /googleusercontent\.com/i.test(value)
      ? value.replace(/=[whs]\d+(?:-[a-z0-9-]+)?(?:-[whs]\d+(?:-[a-z0-9-]+)?)?.*$/i, "=s0")
      : value;
  };
  const hash = (value = "") => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  // Crude stemmer so "springs" matches "spring" and "matching" matches "matched".
  const stemWord = (word = "") => (word.length > 4 ? word.replace(/(?:ings|ing|ed|es|s)$/, "") : word);
  const stemText = (value = "") => normalize(value).split(" ").filter(Boolean).map(stemWord).join(" ");
  const termScore = (clean, terms = []) => terms.reduce((sum, rawTerm) => {
    const term = stemText(rawTerm);
    if (!term || !` ${clean} `.includes(` ${term} `)) return sum;
    const words = term.split(" ").length;
    return sum + (words * words * 3) + Math.min(term.length / 8, 4);
  }, 0);
  const classify = (text = "") => {
    const clean = stemText(text);
    let best = SERVICES[SERVICES.length - 1];
    let bestScore = 0;
    // "Installation" and "General repairs" are catch-alls: the words they match
    // ("install", "repair") also appear alongside a real trade, so scored flat they
    // steal keywords like "flooring installation". They only win when no specific
    // trade matched at all.
    const scored = SERVICES.map((service) => {
      const parentScore = termScore(clean, service.terms) * 1.65;
      const specificScore = Math.max(0, ...service.subcategories.map((subcategory) => termScore(clean, subcategory.terms)));
      return { service, score: parentScore + specificScore };
    });
    scored.forEach((entry) => {
      const score = entry.service.generic ? entry.score * 0.6 : entry.score;
      if (score > bestScore) { best = entry.service; bestScore = score; }
    });
    const scoredSubcategories = best.subcategories.map((subcategory) => ({ subcategory, score: termScore(clean, subcategory.terms) }));
    const specific = scoredSubcategories.reduce((winner, item) => item.score > winner.score ? item : winner, { subcategory: null, score: 0 });
    const fallback = best.subcategories[best.subcategories.length - 1];
    const subcategory = specific.subcategory || fallback;
    return {
      id: best.id, label: best.label, color: best.color, matched: bestScore > 0,
      confidence: bestScore ? Math.min(99, Math.round(66 + bestScore * 1.6)) : 50,
      subcategory: { id: subcategory.id, label: subcategory.label, confidence: specific.score ? Math.min(99, Math.round(64 + specific.score * 2)) : 50 }
    };
  };
  const serviceIdentity = (keyword = "") => {
    const rule = serviceRuleFor(keyword);
    if (!rule) return classify(keyword);
    const family = SERVICES.find((service) => normalize(service.id) === normalize(rule.family) || normalize(service.label) === normalize(rule.family));
    const serviceId = family?.id || slug(rule.family);
    const subcategory = family?.subcategories.find((item) => normalize(item.id) === normalize(rule.subcategory) || normalize(item.label) === normalize(rule.subcategory));
    return {
      id: serviceId,
      label: family?.label || rule.family,
      color: family?.color || "#78c7ff",
      matched: true,
      confidence: 99,
      subcategory: { id: subcategory?.id || slug(rule.subcategory), label: subcategory?.label || rule.subcategory, confidence: 99 }
    };
  };
  const reviewKey = (review) => hash([review.author, normalize(review.text), review.placeId || review.placeName].join("|"));
  const reviewContentKey = (review) => {
    const text = normalize(review.text || "");
    const place = normalize(review.placeId || review.placeName || review.business || "");
    return text && place ? hash(`${text}|${place}`) : "";
  };
  const isGeneralSubcategory = (id = "") => /(?:^|-)general$/.test(id);
  // "General repairs", "Home maintenance", "Handyman service" and every family's
  // own catch-all subsection are where a review lands when nothing in it said what
  // the job actually was. Those are still real five-star reviews worth keeping, but
  // they are the last ones that should be used to fill a row.
  const isCatchAllClassification = (classified) => classified?.id === "general" || isGeneralSubcategory(classified?.subcategory?.id);
  // Words that describe the act, not the thing. "toilet replacement" is about
  // toilets; "replacement" tells us nothing to look for in a review.
  const ACTION_WORDS = new Set(["repair", "repairs", "repaired", "replace", "replaced", "replacement", "install", "installed", "installation", "service", "services", "serviced", "work", "works", "job", "jobs", "fix", "fixed", "fixing", "new", "the", "and", "for", "our", "my", "with", "a", "an", "of", "in", "on", "to"]);
  const contentWords = (value = "") => [...new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !ACTION_WORDS.has(word)).map(stemWord))];
  const wordsIn = (value = "") => new Set(normalize(value).split(" ").filter(Boolean).map(stemWord));
  const signalScore = (value, signals = []) => {
    const clean = ` ${stemText(value)} `;
    return signals.reduce((score, signal) => {
      const wanted = stemText(signal);
      return wanted && clean.includes(` ${wanted} `) ? score + Math.max(1, wanted.split(" ").length) : score;
    }, 0);
  };
  const hasSignal = (value, signals = []) => signalScore(value, signals) > 0;
  const hasEverySignal = (value, signals = []) => signals.every((signal) => hasSignal(value, [signal]));
  // Matching rules intentionally use small, human signals rather than demanding
  // the full Structure phrase. They are different for the business identity and
  // the review copy: "Ashton Plumbing" is not a toilet specialist, but "Ashton
  // Toilet Repairs" is; the review itself only needs to say "toilet".
  const keywordSignalProfile = (keyword, classified = classify(keyword)) => {
    const managed = serviceRuleFor(keyword);
    if (managed) return {
      id: serviceIdentity(keyword).id,
      businessSignals: managed.businessSignals,
      reviewSignals: managed.reviewSignals.length ? managed.reviewSignals : [managed.keyword],
      requiredSignals: managed.requiredSignals,
      topicSignals: managed.topicSignals.length ? managed.topicSignals : (managed.reviewSignals.length ? managed.reviewSignals : [managed.keyword]),
      excludeSignals: managed.excludeSignals,
      collectFamilyInventory: managed.collectFamilyInventory,
      rule: managed
    };
    const clean = normalize(keyword);
    const subcategory = classified.subcategory?.id || "";
    if (classified.id === "garage-doors") {
      const precise = {
        "track-repair": ["track", "tracks", "rail", "rails", "roller", "rollers", "realigned"],
        "spring-repair": ["spring", "springs", "torsion"],
        "opener-repair": ["opener", "motor", "remote", "keypad", "sensor"],
        "cable-repair": ["cable", "cables", "drum"],
        "panel-repair": ["panel", "panels", "section"],
        "garage-installation": ["garage door installation", "garage door install", "installed garage door", "installed a garage door", "installed the garage door", "new garage door", "brand new garage door", "garage door replacement", "replaced garage door", "replaced the garage door", "put in garage door", "put in a garage door"],
        "garage-maintenance": ["garage", "door", "track", "lubricated", "tune up"]
      };
      return {
        id: "garage-doors",
        businessSignals: ["garage", "overhead"],
        reviewSignals: precise[subcategory] || ["garage", "door"],
        topicSignals: precise[subcategory] || ["garage", "door"],
        collectFamilyInventory: true
      };
    }
    if (classified.id === "painting") {
      if (subcategory === "exterior-painting") return {
        id: "exterior-painting",
        businessSignals: ["paint", "painting", "painter", "exterior"],
        reviewSignals: ["exterior painting", "painted exterior", "painted the exterior", "painted outside", "painted the outside", "outside paint", "outside of house", "outside of the house", "house exterior", "exterior wall", "exterior walls", "painted siding", "siding paint"]
      };
      return { id: "painting", businessSignals: ["paint", "painted", "painting", "painter", "painters"], reviewSignals: ["paint", "painted", "painting", "painter", "painters"] };
    }
    if (classified.id === "drywall") return { id: "drywall", businessSignals: ["drywall", "patch", "patched", "sheetrock", "sheet rock"], reviewSignals: ["patch", "patched", "drywall", "hole", "water damage", "water damaged", "taping", "water leak", "sheetrock", "sheet rock", "ceiling", "plaster", "texture"] };
    if (classified.id === "holiday-lighting" && subcategory !== "holiday-light-removal") return { id: "holiday-lights", businessSignals: ["christmas", "holiday", "govee", "permanent"], reviewSignals: ["light", "lights", "govee", "christmas", "holiday"] };
    if (classified.id === "junk-removal") return { id: "junk-removal", businessSignals: ["junk", "haul", "hauling", "hauler", "debris", "cleanout", "clearout", "removal", "waste", "rubbish", "dumpster"], reviewSignals: ["junk", "remove", "removed", "removal", "haul", "hauled", "hauling", "debris", "cleanout", "clearout", "trash", "mattress", "matress", "waste", "rubbish", "clutter", "dumpster", "disposal", "disposed", "discard", "discarded", "pickup"] };
    if (classified.id === "moving") return { id: "moving", businessSignals: ["move", "moves", "moved", "moving", "mover", "movers"], reviewSignals: ["move", "moves", "moved", "moving", "mover", "movers", "relocation"] };
    if (classified.id === "plumbing" && subcategory === "toilet-repair") return { id: "toilet", businessSignals: ["toilet"], reviewSignals: ["toilet"] };
    if (classified.id === "electrical" && subcategory === "outlets-switches") return { id: "outlet", businessSignals: ["outlet", "receptacle", "receptable", "gfci", "duplex", "tamper resistant"], reviewSignals: ["outlet", "outlets", "receptacle", "receptacles", "receptable", "gfci", "plug", "duplex", "tamper resistant", "standard duplex", "tr"] };
    if (/\b(?:tv|television)\b/.test(clean) || subcategory === "tv-mounting") return { id: "tv-mounting", businessSignals: ["tv", "television", "mount", "mounted", "mounting"], reviewSignals: ["tv", "television", "mount", "mounted", "mounting"] };
    if (subcategory === "picture-hanging" || /\b(?:picture|frame|artwork|gallery)\b/.test(clean)) return { id: "picture-hanging", businessSignals: ["picture", "frame", "hanging", "hanger", "artwork", "gallery"], reviewSignals: ["picture", "pictures", "frame", "frames", "hanging", "hung", "artwork", "gallery"] };
    if (classified.id === "installation" && subcategory === "furniture-assembly") return { id: "furniture-assembly", businessSignals: ["furniture", "assemble", "assembled", "assembly", "flatpack", "ikea", "wardrobe", "cabinet"], reviewSignals: ["furniture", "assemble", "assembled", "assembling", "assembly", "flatpack", "flat pack", "ikea", "wardrobe", "dresser", "bed", "bed frame", "bedframe", "bunk bed", "bunkbed", "crib", "cot", "table", "dining table", "dinning table", "desk", "chair", "chairs", "office chair", "shelf", "shelves", "shelving", "bookshelf", "bookcase", "drawer", "drawers", "chest of drawers", "nightstand", "armoire", "cabinet", "cabinets", "vanity", "patio furniture", "office furniture", "entertainment center", "entertainment unit", "storage unit"] };
    if (classified.id === "cleaning" || /\b(?:window|gutter|rainspout|carpet|rug|carpeting|upholstery|pressure|power)\b/.test(clean)) {
      if (subcategory === "window-cleaning" || /\bwindows?\b/.test(clean)) return { id: "window-cleaning", businessSignals: ["window", "windows"], reviewSignals: ["window", "windows"] };
      if (subcategory === "gutter-cleaning" || /\b(?:gutter|rainspout|downspout)\b/.test(clean)) return { id: "gutter-cleaning", businessSignals: ["gutter", "gutters", "rainspout", "downspout"], reviewSignals: ["gutter", "gutters", "rainspout", "downspout"] };
      if (subcategory === "carpet-cleaning" || /\b(?:carpet|rug|carpeting)\b/.test(clean)) return { id: "carpet-cleaning", businessSignals: ["carpet", "rug", "carpeting"], reviewSignals: ["carpet", "carpets", "rug", "rugs", "carpeting"] };
      if (subcategory === "upholstery-cleaning" || /\b(?:upholstery|sofa|couch)\b/.test(clean)) return { id: "upholstery-cleaning", businessSignals: ["upholstery", "sofa", "couch"], reviewSignals: ["sofa", "sofas", "couch", "couches"] };
      if (subcategory === "pressure-washing" || /\b(?:pressure|power)\b/.test(clean)) return { id: "pressure-washing", businessSignals: ["pressure", "powerwash", "powerwashed", "power washing"], reviewSignals: ["pressure", "powerwash", "powerwashed", "power washing", "power washed"] };
    }
    if (classified.id === "appliance") {
      if (/\b(?:fridge|refrigerator|freezer)\b/.test(clean)) return { id: "refrigeration", businessSignals: ["fridge", "refrigerator", "freezer"], reviewSignals: ["fridge", "refrigerator", "freezer"] };
      if (/\bdishwasher\b/.test(clean)) return { id: "dishwasher", businessSignals: ["dishwasher"], reviewSignals: ["dishwasher"] };
      if (/\b(?:stove|oven|range|cooktop|stovetop)\b/.test(clean)) return { id: "cooking-appliance", businessSignals: ["stove", "oven", "range", "cooktop", "stovetop"], reviewSignals: ["stove", "oven", "range", "cooktop", "stovetop"] };
      if (/\b(?:washing machine|washer)\b/.test(clean)) return { id: "washer", businessSignals: ["washing machine", "washer"], reviewSignals: ["washing machine", "washer"] };
      if (/\bdryer\b/.test(clean)) return { id: "dryer", businessSignals: ["dryer"], reviewSignals: ["dryer"] };
      if (/\bmicrowave\b/.test(clean)) return { id: "microwave", businessSignals: ["microwave"], reviewSignals: ["microwave"] };
      const appliances = ["appliance", "fridge", "refrigerator", "freezer", "dishwasher", "stove", "oven", "range", "cooktop", "stovetop", "washing machine", "washer", "dryer", "microwave"];
      return { id: "appliance", businessSignals: appliances, reviewSignals: appliances };
    }
    return null;
  };
  const businessKeywordMatchScore = (identity, keyword) => {
    const profile = keywordSignalProfile(keyword);
    return profile ? signalScore(identity, profile.businessSignals) : 0;
  };
  const businessMatchesKeyword = (identity, keyword) => {
    const profile = keywordSignalProfile(keyword);
    if (profile) return profile.businessSignals.length > 0 && hasSignal(identity, profile.businessSignals);
    const target = classify(keyword);
    const targetService = SERVICES.find((service) => service.id === target.id);
    const targetSubcategory = targetService?.subcategories.find((subcategory) => subcategory.id === target.subcategory?.id);
    return hasConceptEvidence(identity, [keyword, targetSubcategory?.label || "", ...(targetSubcategory?.terms || [])]);
  };
  const topicKeywordMatchScore = (text, keyword) => {
    const profile = keywordSignalProfile(keyword);
    return profile ? signalScore(text, profile.topicSignals || profile.reviewSignals) : keywordMatchScore(text, keyword);
  };
  const requiresTopicMatch = (keyword) => {
    const managed = serviceRuleFor(keyword);
    if (managed) return managed.topicRequired;
    const target = classify(keyword);
    return target.id === "plumbing" && target.subcategory?.id === "toilet-repair";
  };
  const defaultServiceRule = (keyword = "") => {
    const target = classify(keyword);
    const profile = keywordSignalProfile(keyword, target);
    const service = SERVICES.find((item) => item.id === target.id);
    const normalizedKeyword = normalize(keyword);
    const christmas = /christmas (?:light|lighting)/.test(normalizedKeyword);
    const holiday = /holiday (?:light|lighting)/.test(normalizedKeyword);
    return {
      keyword: String(keyword || "").trim(),
      searchTerm: service?.collapseToFamily ? (service.searchTerm || keyword) : String(keyword || "").trim(),
      businessSignals: profile?.businessSignals || [keyword],
      reviewSignals: profile?.reviewSignals || [keyword],
      requiredSignals: profile?.requiredSignals || [],
      topicSignals: profile?.topicSignals || profile?.reviewSignals || [keyword],
      excludeSignals: profile?.excludeSignals || [],
      family: target.matched ? target.label : String(keyword || "").trim(),
      subcategory: target.matched ? target.subcategory.label : String(keyword || "").trim(),
      topicRequired: requiresTopicMatch(keyword),
      collectFamilyInventory: Boolean(profile?.collectFamilyInventory),
      rewriteServicePhrase: christmas ? "Christmas lights" : holiday ? "holiday lights" : String(keyword || "").trim(),
      equivalentServicePhrases: christmas
        ? ["holiday lights", "holiday lighting", "Christmas lighting"]
        : holiday ? ["Christmas lights", "Christmas lighting", "holiday lighting"] : []
    };
  };
  // Natural reviews rarely repeat the exact requested phrase. Match the useful
  // words in any known synonym regardless of order, so "hole in our wall" can
  // satisfy "hole in the wall" and "off its rails" can satisfy track repair.
  const hasConceptEvidence = (value, phrases = []) => {
    const present = wordsIn(value);
    return phrases.some((phrase) => {
      const wanted = contentWords(phrase);
      return wanted.length > 0 && wanted.every((word) => present.has(word));
    });
  };
  // signalScore counts list entries, so one word in the review can score three
  // when three spellings of it stem alike ("paint", "painted", "painting"). This
  // counts the distinct evidence instead: how many different things this trade's
  // vocabulary actually found.
  const distinctSignalHits = (value, signals = []) => {
    const clean = ` ${stemText(value)} `;
    const hits = new Set();
    signals.forEach((signal) => {
      const wanted = stemText(signal);
      if (wanted && clean.includes(` ${wanted} `)) hits.add(wanted);
    });
    return hits.size;
  };
  // The subsection Fudge assigned is the strongest thing it knows about a review,
  // and it is what the Reviews tab shows. A definite subsection from another trade
  // settles the question: a moving review stays a moving review however the word
  // "paint" got into the sentence. Two exceptions keep that from overreaching — a
  // catch-all subsection ("General repairs", "General maintenance") claims nothing
  // about the review, and this keyword's own vocabulary turning up more than once
  // is evidence rather than the coincidence of a single shared word, which is how
  // "repaired the ceiling after a water leak" stays a drywall job.
  const subcategoryBelongsElsewhere = (actual, target, context, profile) => {
    if (!actual?.matched) return false;
    // A catch-all classification says nothing about the review, so it settles
    // nothing: the "General repairs" family, and any family's own catch-all.
    if (isCatchAllClassification(actual)) return false;
    // Within one trade the subsection is not dependable enough to overrule the
    // keyword: "They mounted our television" classifies as mounting-shelving, so
    // comparing subsections here would throw away the very review being asked for.
    if (actual.id === target.id) return false;
    return distinctSignalHits(context, profile.reviewSignals) < 2;
  };
  // Does the review actually talk about what the keyword named?
  const reviewMentionsKeyword = (review, keyword) => {
    const profile = keywordSignalProfile(keyword);
    if (profile) return hasSignal(`${review.text || ""} ${review.serviceLabels || ""} ${review.reviewTopic || ""}`, profile.reviewSignals);
    const wanted = contentWords(keyword);
    if (!wanted.length) return true;
    const present = wordsIn(`${review.text || ""} ${review.serviceLabels || ""}`);
    return wanted.every((word) => present.has(word));
  };
  // "plumbing" names the trade itself, so any plumbing review fits. "toilet
  // replacement" names a thing inside that trade, so it has to be mentioned.
  const isFamilyLevelKeyword = (keyword, serviceId) => {
    const service = SERVICES.find((item) => item.id === serviceId);
    if (!service) return false;
    const familyWords = new Set(contentWords(service.label));
    const wanted = contentWords(keyword);
    return wanted.length > 0 && wanted.every((word) => familyWords.has(word));
  };
  // Scores a short label (a Google review-topic chip such as "toilet replacement")
  // against a service keyword. Only a full match counts; the score is the number of
  // keyword words matched, so the caller can prefer the most specific topic.
  const keywordMatchScore = (text, keyword) => {
    const wanted = contentWords(keyword);
    if (!wanted.length) return 0;
    const present = wordsIn(text);
    return wanted.every((word) => present.has(word)) ? wanted.length : 0;
  };
  // "General repairs" is not a trade; it is Fudge recording that it could not tell.
  // A review filed there is not evidence of a *different* trade, so it stays
  // eligible for any keyword and the fill order keeps it last. Note this is the
  // family, not a family's own "General ..." subsection: plumbing/plumbing-general
  // is still plumbing and still rules out a different trade.
  const recordedElsewhere = (sourceServiceId, target) => Boolean(
    sourceServiceId && sourceServiceId !== "general" && target.matched && sourceServiceId !== target.id
  );
  const matchesServiceKeyword = (review, keyword) => {
    const managed = serviceRuleFor(keyword);
    const target = serviceIdentity(keyword);
    const managedContext = `${review.text || ""} ${review.serviceLabels || ""} ${review.reviewTopic || ""}`;
    if (managed) {
      const profile = keywordSignalProfile(keyword, target);
      if (profile.excludeSignals.length && hasSignal(managedContext, profile.excludeSignals)) return false;
      if (!hasSignal(managedContext, profile.reviewSignals)) return false;
      if (profile.requiredSignals.length && !hasEverySignal(managedContext, profile.requiredSignals)) return false;
      const actual = review.service || classify(`${review.text || ""} ${review.serviceLabels || ""}`);
      if (review.sourceServiceId && review.sourceServiceId !== "general" && review.sourceServiceId !== target.id) return false;
      if (actual?.id === target.id && !isGeneralSubcategory(target.subcategory?.id)
        && !isGeneralSubcategory(actual.subcategory?.id) && target.subcategory?.id !== actual.subcategory?.id) return false;
      return true;
    }
    if (recordedElsewhere(review.sourceServiceId, target)) return false;
    if (review.sourceServiceId === target.id && isGeneralSubcategory(target.subcategory?.id)) return true;
    const actual = review.service || classify(`${review.text || ""} ${review.serviceLabels || ""}`);
    const targetService = SERVICES.find((service) => service.id === target.id);
    const actualService = SERVICES.find((service) => service.id === actual.id);
    const targetSubcategory = targetService?.subcategories.find((subcategory) => subcategory.id === target.subcategory?.id);
    const reviewContext = `${review.text || ""} ${review.serviceLabels || ""} ${review.reviewTopic || ""}`;
    const businessContext = `${review.placeName || ""} ${review.business || ""} ${review.placeCategory || ""}`;
    const evidencePhrases = [keyword, targetSubcategory?.label || "", ...(targetSubcategory?.terms || [])];
    const hasReviewEvidence = hasConceptEvidence(reviewContext, evidencePhrases);
    const hasBusinessEvidence = keywordMatchScore(businessContext, keyword) > 0 || hasConceptEvidence(businessContext, evidencePhrases);
    const profile = keywordSignalProfile(keyword, target);

    // For the explicitly configured services, one related review word is enough.
    // The business name controls whether Google needs a topic filter; it does not
    // by itself turn generic praise into a matching review.
    if (profile) {
      if (!hasSignal(reviewContext, profile.reviewSignals)) return false;
      // Garage-door subtypes are materially different jobs. An installation
      // review can mention its new tracks, but it must not fill a track-repair
      // requirement (and a repair must never stand in for a full installation).
      if (target.id === "garage-doors" && actual.id === "garage-doors"
        && !isGeneralSubcategory(target.subcategory?.id)
        && !isGeneralSubcategory(actual.subcategory?.id)
        && target.subcategory?.id !== actual.subcategory?.id) return false;
      return !subcategoryBelongsElsewhere(actual, target, reviewContext, profile);
    }

    // If classification missed the family because the customer used natural
    // wording, strong review/business evidence may recover it. Never override a
    // confidently classified, different trade.
    if (target.id !== actual.id) {
      return Boolean((!actual.matched || actualService?.generic) && (hasReviewEvidence || hasBusinessEvidence));
    }
    if (!isGeneralSubcategory(target.subcategory?.id)) {
      if (target.subcategory?.id === actual.subcategory?.id) return true;
      // A known conflicting subtype stays separate (track versus spring/opener).
      if (!isGeneralSubcategory(actual.subcategory?.id)) return false;
      return hasReviewEvidence || hasBusinessEvidence;
    }
    // The keyword landed on a family's catch-all subcategory. Treating that as
    // "anything in this trade will do" is what let a water-heater review satisfy
    // a "toilet replacement" requirement.
    if (isFamilyLevelKeyword(keyword, target.id)) return true;
    return hasReviewEvidence || hasBusinessEvidence || reviewMentionsKeyword(review, keyword);
  };
  const shouldCollectSpecialistInventory = (review, keyword) => {
    const target = serviceIdentity(keyword);
    if (recordedElsewhere(review.sourceServiceId, target)) return false;
    const profile = keywordSignalProfile(keyword, target);
    if (!profile?.collectFamilyInventory) return false;
    const identity = `${review.placeName || ""} ${review.business || ""} ${review.placeCategory || ""}`;
    if (!businessMatchesKeyword(identity, keyword)) return false;
    const actual = review.service || classify(`${review.text || ""} ${review.serviceLabels || ""}`);
    return !actual.matched || actual.id === target.id;
  };
  const classifyWithinService = (review, serviceId) => {
    const service = SERVICES.find((item) => item.id === serviceId);
    if (!service) return classify(`${review.text || ""} ${review.serviceLabels || ""} ${review.reviewTopic || ""}`);
    const context = stemText(`${review.text || ""} ${review.serviceLabels || ""} ${review.reviewTopic || ""}`);
    const scored = service.subcategories.map((subcategory) => ({ subcategory, score: termScore(context, subcategory.terms) }));
    const specific = scored.reduce((winner, item) => item.score > winner.score ? item : winner, { subcategory: null, score: 0 });
    const subcategory = specific.subcategory || service.subcategories[service.subcategories.length - 1];
    return {
      id: service.id,
      label: service.label,
      color: service.color,
      matched: true,
      confidence: specific.score ? Math.min(99, Math.round(72 + specific.score * 2)) : 68,
      subcategory: {
        id: subcategory.id,
        label: subcategory.label,
        confidence: specific.score ? Math.min(99, Math.round(68 + specific.score * 2)) : 60
      }
    };
  };
  const classifyForKeyword = (review, keyword) => {
    const context = `${review.text || ""} ${review.serviceLabels || ""} ${review.reviewTopic || ""}`;
    const actual = classify(context);
    // A review collected from a confirmed specialist belongs to that trade even
    // when an ambiguous verb such as "moved" appears in the sentence. Continue
    // classifying its subsection, but never let that word move it into a different
    // service family.
    if (review.sourceServiceId) return classifyWithinService(review, review.sourceServiceId);
    if (!keyword) return actual;
    const target = serviceIdentity(keyword);
    const profile = keywordSignalProfile(keyword, target);
    if (!profile || (profile.excludeSignals?.length && hasSignal(context, profile.excludeSignals))
      || !hasSignal(context, profile.reviewSignals)
      || (profile.requiredSignals?.length && !hasEverySignal(context, profile.requiredSignals))) return actual;
    // Keep a precise subsection discovered in the review itself (for example a
    // spring review found while scanning a garage-door business). When a broad
    // word such as "windows" or "rug" was otherwise mistaken for installation
    // or flooring, the active requirement supplies the correct service context.
    return actual.id === target.id ? actual : target;
  };
  // The keyword is searched as written, because the speciality is what finds the
  // businesses whose reviews are about it — "toilet replacement" beats "plumbing".
  // The exception is a family marked `collapseToFamily`, where the speciality is
  // not how businesses list themselves: nobody advertises "washer repair", they
  // advertise "appliance repair". Flag another family to collapse it the same way.
  const searchTermFor = (keyword = "") => {
    const text = String(keyword).trim();
    if (!text) return "";
    const managed = serviceRuleFor(text);
    if (managed) return managed.searchTerm || text;
    const result = classify(text);
    if (!result.matched) return text;
    const service = SERVICES.find((item) => item.id === result.id);
    return service?.collapseToFamily ? (service.searchTerm || text) : text;
  };
  const buildSearchQuery = (keyword = "", city = "") => {
    const term = searchTermFor(keyword);
    const place = String(city).trim();
    if (!term) return place;
    return place ? `${term} in ${place}` : term;
  };
  const isLikelyReviewPhoto = (url = "", avatar = "") => url && url !== avatar && !/googleusercontent\.com\/a-|profile|s40-c|s64-c/i.test(url);
  const getReviews = () => new Promise((resolve) => chrome.storage.local.get({ reviews: [], serviceRules: [] }, ({ reviews, serviceRules }) => {
    setServiceRules(serviceRules);
    let changed = false;
    const clean = reviews.map((review) => {
      const photos = [...new Set((review.photos || []).filter((url) => isLikelyReviewPhoto(url, review.avatar)).map(originalPhotoUrl))];
      const sourceKeyword = review.matchedKeyword || review.searchKeyword || "";
      const target = sourceKeyword ? serviceIdentity(sourceKeyword) : null;
      const identity = `${review.placeName || ""} ${review.business || ""} ${review.placeCategory || ""}`;
      const sourceServiceId = review.sourceServiceId || (target?.matched && businessMatchesKeyword(identity, sourceKeyword) ? target.id : "");
      const service = classifyForKeyword({ ...review, sourceServiceId }, sourceKeyword);
      if (photos.length !== (review.photos || []).length || sourceServiceId !== (review.sourceServiceId || "") || service.id !== review.service?.id || service.subcategory.id !== review.service?.subcategory?.id) changed = true;
      return { ...review, photos, sourceServiceId, service };
    }).filter((review) => {
      const keep = review.rating === 5 && (review.photos.length || review.reviewMode === "without-picture");
      if (!keep) changed = true;
      return keep;
    });
    if (changed) chrome.storage.local.set({ reviews: clean });
    resolve(clean);
  }));
  // A silent write failure (quota exceeded, storage evicted) is indistinguishable
  // from "it never saved". Surface it so the UI can report it instead.
  const saveReviews = async (reviews, capturedReviews = []) => {
    const writes = { reviews };
    if (capturedReviews.length && globalThis.FudgeBackendContract) {
      const { fudgeBackendConfig = null } = await chrome.storage.local.get({ fudgeBackendConfig: null });
      // Collection and immutable per-capture intents use the SAME local write.
      // Unique intent keys avoid cross-tab append/read-modify-write queue races.
      Object.assign(writes, FudgeBackendContract.captureWrites(fudgeBackendConfig, capturedReviews));
    }
    return new Promise((resolve, reject) => chrome.storage.local.set(writes, () => {
    const failure = chrome.runtime.lastError;
    if (failure) reject(new Error(failure.message || "Could not write to local storage."));
    else resolve(reviews);
    }));
  };
  // Releasing a review is recorded, not just inferred from an empty usedAt. The
  // Sheet is shared with the Apps Script connector, so "this library has no usedAt"
  // on its own cannot tell an intentional release apart from a local copy that
  // simply has not heard about the connector's work yet.
  const setReviewUsed = async (id, used = true) => {
    const reviews = await getReviews();
    const changedAt = new Date().toISOString();
    const updated = reviews.map((review) => review.id === id
      ? { ...review, usedAt: used ? changedAt : null, releasedAt: used ? null : changedAt }
      : review);
    await saveReviews(updated);
    return updated;
  };
  const clearReviewSubset = async (removeWhen) => {
    const reviews = await getReviews();
    const removed = reviews.filter(removeWhen);
    const kept = reviews.filter((review) => !removeWhen(review));
    await saveReviews(kept);

    // Clear only local Drive-link cache entries that belong exclusively to the
    // removed reviews. Files already uploaded to Google Drive are not deleted.
    const removedUrls = new Set(removed.flatMap((review) => review.photos || []));
    const keptUrls = new Set(kept.flatMap((review) => review.photos || []));
    const { drivePhotoIndex = {} } = await chrome.storage.local.get({ drivePhotoIndex: {} });
    let indexChanged = false;
    removedUrls.forEach((url) => {
      if (!keptUrls.has(url) && drivePhotoIndex[url]) {
        delete drivePhotoIndex[url];
        indexChanged = true;
      }
    });
    if (indexChanged) await chrome.storage.local.set({ drivePhotoIndex });
    return { reviews: kept, removed: removed.length };
  };
  const clearUsedReviews = () => clearReviewSubset((review) => Boolean(review.usedAt));
  const clearUnusedReviews = () => clearReviewSubset((review) => !review.usedAt);
  const stableIdentities = (review) => {
    const identities = [];
    if (review.googleReviewId) identities.push(`google:${review.googleReviewId}`);
    const author = normalize(review.author || "");
    const place = normalize(review.placeId || review.placeName || "");
    if (author && author !== "google reviewer" && place) identities.push(`author-place:${author}|${place}`);
    const contentKey = reviewContentKey(review);
    if (contentKey) identities.push(`content-place:${contentKey}`);
    return identities;
  };
  const addReviews = async (incoming) => {
    const current = await getReviews();
    const accepted = [];
    const merged = [...current];
    let duplicates = 0;
    incoming.forEach((review) => {
      const service = review.service?.id ? review.service : classifyForKeyword(review, review.matchedKeyword || "");
      const item = { ...review, service, id: review.googleReviewId ? `google:${review.googleReviewId}` : review.id || reviewKey(review) };
      const identities = stableIdentities(item);
      const all = [...accepted, ...merged];
      const matchIndex = all.findIndex((existing) => existing.id === item.id || stableIdentities(existing).some((identity) => identities.includes(identity)));
      if (matchIndex < 0) {
        accepted.push(item);
        return;
      }
      duplicates += 1;
      const existing = all[matchIndex];
      const text = (item.text || "").length > (existing.text || "").length ? item.text : existing.text;
      const photos = [...new Set([...(existing.photos || []), ...(item.photos || [])].map(originalPhotoUrl))];
      const driveByPhoto = new Map();
      [existing, item].forEach((source) => {
        (source.photos || []).forEach((photo, index) => {
          const drive = source.drivePhotos?.[index];
          if (drive) driveByPhoto.set(originalPhotoUrl(photo), drive);
        });
      });
      const upgraded = {
        ...existing,
        ...item,
        text,
        photos,
        drivePhotos: photos.map((photo) => driveByPhoto.get(photo) || null),
        usedAt: existing.usedAt || null,
        service: item.service?.id ? item.service : classifyForKeyword({ ...item, text, serviceLabels: item.serviceLabels || existing.serviceLabels || "" }, item.matchedKeyword || existing.matchedKeyword || "")
      };
      if (matchIndex < accepted.length) accepted[matchIndex] = upgraded;
      else merged[matchIndex - accepted.length] = upgraded;
    });
    await saveReviews([...accepted, ...merged], incoming);
    return { accepted: accepted.length, acceptedIds: accepted.map((review) => review.id), duplicates, total: merged.length + accepted.length };
  };
  return { SERVICES, normalize, originalPhotoUrl, driveFileId, driveShareLink, hash, classify, serviceIdentity, setServiceRules, defaultServiceRule, classifyForKeyword, matchesServiceKeyword, shouldCollectSpecialistInventory, businessMatchesKeyword, businessKeywordMatchScore, topicKeywordMatchScore, requiresTopicMatch, isCatchAllClassification, reviewMentionsKeyword, keywordMatchScore, searchTermFor, buildSearchQuery, reviewKey, reviewContentKey, getReviews, saveReviews, setReviewUsed, clearUsedReviews, clearUnusedReviews, addReviews };
})();
