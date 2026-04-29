/** Preset titles for role / profile comboboxes (substring search, custom values allowed). */
export const ROLE_SUGGESTIONS: string[] = [
  // Engineering
  "Software Engineer", "SDE", "Backend Engineer",
  "Frontend Engineer", "Full Stack Engineer",
  "iOS Engineer", "Android Engineer", "Mobile Engineer",
  "DevOps Engineer", "Platform Engineer", "SRE",
  "ML Engineer", "AI Engineer", "MLOps Engineer",
  "Data Engineer", "Analytics Engineer",
  "Security Engineer", "QA Engineer", "SDET",
  "Embedded Engineer", "Systems Engineer",
  "Cloud Engineer", "Infrastructure Engineer",

  // Data
  "Data Scientist", "Data Analyst",
  "Business Intelligence Analyst", "BI Developer",
  "Research Scientist", "Applied Scientist",
  "Quantitative Analyst",

  // Product & Design
  "Product Manager", "Technical Product Manager",
  "UX Designer", "UI Designer", "Product Designer",
  "UX Researcher", "Design Lead",

  // Business & Operations
  "Business Analyst", "Operations Analyst",
  "Strategy Analyst", "Management Consultant",
  "Business Development Manager",
  "Operations Manager", "Chief of Staff",

  // Program & Project
  "Program Manager", "Technical Program Manager",
  "Project Manager", "Scrum Master", "Agile Coach",

  // Sales & Marketing
  "Account Executive", "Sales Engineer",
  "Solutions Engineer", "Solutions Architect",
  "Marketing Manager", "Growth Manager",
  "Digital Marketing Specialist", "Content Strategist",
  "Brand Manager", "SEO Specialist",
  "Product Marketing Manager",

  // Finance
  "Financial Analyst", "Investment Analyst",
  "Risk Analyst", "Accounting Manager",
  "Corporate Finance Analyst", "FP&A Analyst",

  // HR & Recruiting
  "HR Manager", "Recruiter", "Technical Recruiter",
  "People Operations", "Talent Acquisition",

  // Research & Academia
  "Research Engineer", "Research Analyst",
  "PhD Researcher", "Postdoc",

  // Leadership
  "Engineering Manager", "Tech Lead",
  "Staff Engineer", "Principal Engineer",
  "Director of Engineering", "VP of Engineering",
  "CTO", "CPO",

  // Other
  "Consultant", "Freelancer", "Entrepreneur",
];

export const ROLE_DROPDOWN_MAX = 14;

/** Stable empty reference for useMemo when query is empty. */
export const ROLE_MATCHES_EMPTY: string[] = [];
