// Demo data. WARNING: wipes all SkillBridge tables first.  Run: npm run db:seed
// Schools, companies and people are fictional. Learning resources point to real
// free providers' home pages; curate real course links before using this in production.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import prisma from '../src/configs/postgres.js'
import { ingest } from '../src/services/ingestionService.js'
import { invalidateTaxonomy } from '../src/services/taxonomyCache.js'

const DEMO_PASSWORD = 'skillbridge123'

// ---------------------------------------------------------------- taxonomy
// [name, category, aliases, parent]
const SKILLS = [
    // Programming & web
    ['JavaScript', 'Programming', ['js', 'ecmascript', 'es6']],
    ['TypeScript', 'Programming', ['ts'], 'JavaScript'],
    ['Python', 'Programming', ['python 3']],
    ['Java', 'Programming', ['java se', 'core java']],
    ['PHP', 'Programming', []],
    ['C#', 'Programming', ['c sharp']],
    ['C++', 'Programming', ['cpp']],
    ['Kotlin', 'Programming', []],
    ['HTML', 'Web', ['html5']],
    ['CSS', 'Web', ['css3', 'tailwind', 'bootstrap']],
    ['React', 'Web', ['react.js', 'reactjs'], 'JavaScript'],
    ['Vue.js', 'Web', ['vue', 'vuejs'], 'JavaScript'],
    ['Angular', 'Web', ['angularjs'], 'TypeScript'],
    ['Node.js', 'Web', ['nodejs', 'node'], 'JavaScript'],
    ['Express.js', 'Web', ['expressjs', 'express'], 'Node.js'],
    ['Laravel', 'Web', [], 'PHP'],
    ['Django', 'Web', [], 'Python'],
    ['Flutter', 'Mobile', []],
    ['REST APIs', 'Web', ['rest api', 'restful api', 'restful apis', 'api development', 'api integration']],
    ['Git', 'Tools', ['github', 'gitlab', 'version control']],
    // Data
    ['SQL', 'Data', ['sql queries', 'relational databases']],
    ['MySQL', 'Data', [], 'SQL'],
    ['PostgreSQL', 'Data', ['postgres'], 'SQL'],
    ['Microsoft SQL Server', 'Data', ['ms sql', 'mssql', 'sql server'], 'SQL'],
    ['MongoDB', 'Data', ['mongo']],
    ['Microsoft Office', 'Office', ['ms office', 'office applications', 'office suite']],
    ['Microsoft Excel', 'Office', ['ms excel', 'excel', 'advanced excel', 'spreadsheets', 'pivot tables'], 'Microsoft Office'],
    ['Microsoft Word', 'Office', ['ms word'], 'Microsoft Office'],
    ['Google Workspace', 'Office', ['google sheets', 'google docs', 'g suite']],
    ['Power BI', 'Data', ['powerbi', 'power bi desktop']],
    ['Tableau', 'Data', []],
    ['Data Analysis', 'Data', ['data analytics', 'analyzing data']],
    ['Data Visualization', 'Data', ['dashboards', 'dashboard reporting', 'data viz']],
    ['Statistics', 'Data', ['statistical analysis']],
    // Infrastructure & support
    ['Docker', 'DevOps', ['containers', 'containerization']],
    ['Linux', 'DevOps', ['ubuntu', 'centos', 'bash']],
    ['AWS', 'Cloud', ['amazon web services']],
    ['Microsoft Azure', 'Cloud', ['azure']],
    ['CI/CD', 'DevOps', ['ci/cd pipelines', 'continuous integration', 'github actions']],
    ['Computer Hardware Troubleshooting', 'IT Support', ['hardware troubleshooting', 'pc troubleshooting', 'computer troubleshooting', 'computer repair']],
    ['Networking', 'IT Support', ['computer networking', 'network administration', 'lan/wan', 'tcp/ip', 'network troubleshooting']],
    ['Windows Server', 'IT Support', []],
    ['Active Directory', 'IT Support', []],
    ['Technical Support', 'IT Support', ['tech support', 'it support', 'help desk', 'helpdesk', 'desktop support']],
    ['Ticketing Systems', 'IT Support', ['ticketing system', 'ticketing tools', 'jira service management', 'servicenow']],
    ['Cybersecurity', 'IT Support', ['information security', 'network security', 'cyber security']],
    // Quality
    ['Software Testing', 'Quality Assurance', ['manual testing', 'qa testing', 'test cases', 'regression testing']],
    ['Test Automation', 'Quality Assurance', ['automated testing', 'automation testing']],
    ['Selenium', 'Quality Assurance', ['selenium webdriver'], 'Test Automation'],
    ['Agile', 'Process', ['scrum', 'agile methodology']],
    ['Project Management', 'Process', []],
    // Design
    ['UI/UX Design', 'Design', ['ui/ux', 'ux design', 'ui design', 'user experience', 'wireframing']],
    ['Figma', 'Design', []],
    ['Graphic Design', 'Design', ['layout design', 'graphic designing']],
    ['Adobe Photoshop', 'Design', ['photoshop']],
    ['Adobe Illustrator', 'Design', ['illustrator']],
    ['Video Editing', 'Design', ['premiere pro', 'video production']],
    // Business & finance
    ['Accounting', 'Finance', ['financial accounting', 'general accounting']],
    ['Bookkeeping', 'Finance', ['book keeping', 'journal entries']],
    ['QuickBooks', 'Finance', []],
    ['SAP', 'Finance', ['sap b1', 'sap business one']],
    ['Payroll', 'Finance', ['payroll processing']],
    ['Taxation', 'Finance', ['tax compliance', 'bir compliance', 'tax filing']],
    ['Auditing', 'Finance', ['internal audit']],
    ['Financial Reporting', 'Finance', ['financial statements']],
    // Marketing
    ['Digital Marketing', 'Marketing', ['online marketing']],
    ['Social Media Management', 'Marketing', ['social media marketing', 'managing social media', 'social media accounts']],
    ['SEO', 'Marketing', ['search engine optimization']],
    ['Content Writing', 'Marketing', ['copywriting', 'content creation', 'writing content']],
    ['Google Analytics', 'Marketing', ['ga4']],
    ['Email Marketing', 'Marketing', ['email campaigns']],
    ['Market Research', 'Marketing', ['marketing research']],
    ['Sales', 'Marketing', ['sales experience', 'selling']],
    // Customer & office
    ['Customer Service', 'Customer Experience', ['customer support', 'customer care', 'customer service experience']],
    ['CRM Software', 'Customer Experience', ['crm', 'salesforce', 'hubspot', 'zendesk']],
    ['Typing', 'Office', ['typing speed', 'fast typist']],
    ['Data Entry', 'Office', ['encoding', 'data encoding']],
    ['Records Management', 'Office', ['filing', 'document management', 'records keeping']],
    ['Scheduling', 'Office', ['calendar management', 'appointment setting']],
    // Professional skills
    ['Communication', 'Professional', ['communication skills', 'verbal and written communication', 'written and verbal communication', 'oral communication']],
    ['English Proficiency', 'Professional', ['good command of english', 'fluent in english', 'excellent english', 'english proficiency']],
    ['Problem Solving', 'Professional', ['problem-solving', 'problem-solving skills', 'troubleshooting skills']],
    ['Teamwork', 'Professional', ['team player', 'collaboration']],
    ['Attention to Detail', 'Professional', ['detail-oriented', 'detail oriented', 'keen eye for detail']],
    ['Time Management', 'Professional', ['multitasking', 'meet deadlines']]
]

// ---------------------------------------------------------------- occupations
const OCCUPATIONS = {
    'Web Developer': ['web developer', 'frontend developer', 'front-end developer', 'backend developer', 'back-end developer', 'full stack developer', 'fullstack developer', 'software developer', 'software engineer', 'php developer', 'programmer'],
    'IT Support Specialist': ['it support', 'technical support specialist', 'help desk', 'helpdesk', 'desktop support', 'it specialist', 'network technician', 'computer technician', 'service desk'],
    'Data Analyst': ['data analyst', 'business intelligence', 'bi analyst', 'reporting analyst', 'data specialist'],
    'QA Tester': ['qa tester', 'qa engineer', 'qa analyst', 'quality assurance tester', 'software tester', 'test engineer'],
    'Customer Service Representative': ['customer service', 'call center agent', 'customer support', 'csr', 'chat support', 'contact center', 'technical support representative'],
    'UI/UX & Graphic Designer': ['ui/ux designer', 'ux designer', 'ui designer', 'graphic designer', 'multimedia designer', 'product designer', 'graphic artist'],
    'Bookkeeper / Accounting Staff': ['bookkeeper', 'accounting staff', 'accounting assistant', 'accounts payable', 'accounts receivable', 'junior accountant', 'payroll'],
    'Digital Marketing Specialist': ['digital marketing', 'social media', 'seo specialist', 'content writer', 'marketing assistant', 'marketing associate'],
    'Administrative Assistant': ['administrative assistant', 'admin assistant', 'office assistant', 'virtual assistant', 'secretary', 'data encoder', 'office clerk']
}

// ---------------------------------------------------------------- schools
const SCHOOLS = [
    {
        code: 'PSI', name: 'Pamantasan ng San Isidro',
        programs: [
            {
                code: 'BSIT', name: 'BS Information Technology',
                occupations: ['Web Developer', 'IT Support Specialist', 'Data Analyst', 'QA Tester', 'UI/UX & Graphic Designer'],
                courses: [
                    ['IT 101', 'Introduction to Computing', ['Microsoft Office', 'Computer Hardware Troubleshooting']],
                    ['IT 102', 'Computer Programming 1', ['Python', 'Problem Solving']],
                    ['IT 103', 'Computer Programming 2', ['Java']],
                    ['IT 201', 'Data Structures and Algorithms', ['Java', 'Problem Solving']],
                    ['IT 202', 'Web Systems and Technologies', ['HTML', 'CSS', 'JavaScript', 'PHP']],
                    ['IT 203', 'Information Management', ['SQL', 'MySQL']],
                    ['IT 204', 'Networking 1', ['Networking']],
                    ['IT 301', 'Integrative Programming and Technologies', ['REST APIs', 'Git', 'Laravel']],
                    ['IT 302', 'System Integration and Architecture', ['Linux']],
                    ['IT 303', 'Human Computer Interaction', ['UI/UX Design', 'Figma']],
                    ['IT 304', 'Quantitative Methods and Analytics', ['Statistics', 'Data Analysis', 'Microsoft Excel']],
                    ['IT 305', 'Information Assurance and Security', ['Cybersecurity']],
                    ['IT 401', 'Capstone Project', ['Project Management', 'Agile', 'Teamwork', 'Communication']]
                ]
            },
            {
                code: 'BSBA-MM', name: 'BS Business Administration major in Marketing Management',
                occupations: ['Digital Marketing Specialist', 'Customer Service Representative', 'Administrative Assistant'],
                courses: [
                    ['MKT 101', 'Principles of Marketing', ['Market Research']],
                    ['MKT 201', 'Digital Marketing', ['Digital Marketing', 'Social Media Management']],
                    ['MKT 301', 'Professional Salesmanship', ['Sales', 'Customer Service']],
                    ['MKT 302', 'Marketing Research', ['Market Research', 'Statistics', 'Data Analysis']],
                    ['BUS 101', 'Business Communication', ['Communication', 'English Proficiency']],
                    ['ICT 101', 'Productivity Tools', ['Microsoft Excel', 'Microsoft Word']]
                ]
            },
            {
                code: 'BSAIS', name: 'BS Accounting Information System',
                occupations: ['Bookkeeper / Accounting Staff', 'Data Analyst', 'Administrative Assistant'],
                courses: [
                    ['ACC 101', 'Financial Accounting and Reporting', ['Accounting', 'Bookkeeping', 'Financial Reporting']],
                    ['ACC 201', 'Cost Accounting', ['Accounting']],
                    ['TAX 101', 'Income Taxation', ['Taxation']],
                    ['AIS 201', 'Accounting Information Systems', ['QuickBooks', 'SQL']],
                    ['AUD 301', 'Auditing and Assurance', ['Auditing', 'Attention to Detail']],
                    ['ICT 101', 'Productivity Tools', ['Microsoft Excel', 'Microsoft Word']]
                ]
            }
        ]
    },
    {
        code: 'SIPC', name: 'San Isidro Polytechnic College',
        programs: [
            {
                // An older curriculum on purpose, to compare against PSI's BSIT
                code: 'BSIT', name: 'BS Information Technology',
                occupations: ['Web Developer', 'IT Support Specialist', 'QA Tester'],
                courses: [
                    ['CS 101', 'Computer Fundamentals', ['Microsoft Office']],
                    ['CP 101', 'Programming in C++', ['C++', 'Problem Solving']],
                    ['DB 201', 'Database Management Systems', ['SQL', 'Microsoft SQL Server']],
                    ['WD 201', 'Web Page Design', ['HTML', 'CSS']],
                    ['NW 301', 'Computer Networks and Maintenance', ['Networking', 'Computer Hardware Troubleshooting']],
                    ['SA 301', 'Systems Analysis and Design', ['Communication']]
                ]
            },
            {
                code: 'BSOA', name: 'BS Office Administration',
                occupations: ['Administrative Assistant', 'Customer Service Representative', 'Bookkeeper / Accounting Staff'],
                courses: [
                    ['OA 101', 'Keyboarding and Document Processing', ['Typing', 'Microsoft Word']],
                    ['OA 102', 'Office Procedures and Records Management', ['Records Management', 'Scheduling']],
                    ['OA 201', 'Office Software Applications', ['Microsoft Office', 'Microsoft Excel']],
                    ['OA 202', 'Business Communication', ['Communication', 'English Proficiency']],
                    ['OA 301', 'Basic Bookkeeping', ['Bookkeeping']],
                    ['OA 302', 'Customer Relations', ['Customer Service']]
                ]
            }
        ]
    }
]

const CERTIFICATIONS = [
    ['Computer Systems Servicing NC II', 'TESDA', ['Computer Hardware Troubleshooting', 'Networking', 'Technical Support', 'Windows Server']],
    ['Contact Center Services NC II', 'TESDA', ['Customer Service', 'Communication', 'English Proficiency', 'Typing']],
    ['Bookkeeping NC III', 'TESDA', ['Bookkeeping', 'Accounting', 'Financial Reporting']],
    ['Visual Graphic Design NC III', 'TESDA', ['Graphic Design', 'Adobe Photoshop', 'Adobe Illustrator']],
    ['Data Analytics Certificate (online course)', 'Online provider', ['Data Analysis', 'SQL', 'Data Visualization', 'Tableau', 'Microsoft Excel']],
    ['Cloud Practitioner Certification', 'Cloud vendor', ['AWS']]
]

// [title, provider, url, hours, skills]
const RESOURCES = [
    ['Responsive Web Design', 'freeCodeCamp', 'https://www.freecodecamp.org/learn', 60, ['HTML', 'CSS']],
    ['JavaScript Algorithms and Data Structures', 'freeCodeCamp', 'https://www.freecodecamp.org/learn', 80, ['JavaScript']],
    ['Front End Development Libraries (React)', 'freeCodeCamp', 'https://www.freecodecamp.org/learn', 60, ['React', 'JavaScript']],
    ['Back End Development and APIs (Node.js, Express)', 'freeCodeCamp', 'https://www.freecodecamp.org/learn', 60, ['Node.js', 'Express.js', 'REST APIs', 'MongoDB']],
    ['Relational Databases with PostgreSQL and Bash', 'freeCodeCamp', 'https://www.freecodecamp.org/learn', 60, ['SQL', 'PostgreSQL', 'Linux', 'Git']],
    ['Data Analysis with Python', 'freeCodeCamp', 'https://www.freecodecamp.org/learn', 50, ['Python', 'Data Analysis']],
    ['Power BI data analyst learning path', 'Microsoft Learn', 'https://learn.microsoft.com/training/', 30, ['Power BI', 'Data Visualization']],
    ['Excel for data analysis', 'Microsoft Learn', 'https://learn.microsoft.com/training/', 12, ['Microsoft Excel', 'Data Analysis']],
    ['Azure fundamentals', 'Microsoft Learn', 'https://learn.microsoft.com/training/', 10, ['Microsoft Azure']],
    ['Get started with Docker', 'Docker Docs', 'https://docs.docker.com/get-started/', 6, ['Docker']],
    ['Linux basics', 'Linux Journey', 'https://linuxjourney.com', 15, ['Linux']],
    ['Test automation courses', 'Test Automation University', 'https://testautomationu.applitools.com', 20, ['Test Automation', 'Selenium', 'Software Testing']],
    ['Digital marketing fundamentals', 'Google Skillshop / Digital Garage', 'https://skillshop.withgoogle.com', 40, ['Digital Marketing', 'SEO', 'Google Analytics']],
    ['Figma design basics', 'Figma Learn', 'https://help.figma.com', 8, ['Figma', 'UI/UX Design']],
    ['Computer hardware and IT support courses', 'TESDA Online Program', 'https://e-tesda.gov.ph', 40, ['Computer Hardware Troubleshooting', 'Technical Support', 'Networking']],
    ['Bookkeeping and payroll courses', 'TESDA Online Program', 'https://e-tesda.gov.ph', 30, ['Bookkeeping', 'Payroll']],
    ['Customer service and contact center courses', 'TESDA Online Program', 'https://e-tesda.gov.ph', 25, ['Customer Service', 'Communication', 'CRM Software']]
]

// ---------------------------------------------------------------- job postings
// Each occupation: titles, then [skill, probability] for required and preferred lists
const PROFILES = {
    'Web Developer': {
        titles: ['Junior Web Developer', 'Full Stack Developer', 'Frontend Developer', 'PHP Developer', 'Junior Software Engineer', 'Backend Developer (Node.js)'],
        must: { 'PHP Developer': ['PHP', 'Laravel'], 'Backend Developer (Node.js)': ['Node.js', 'Express.js'], 'Frontend Developer': ['React'] },
        required: [['JavaScript', .9], ['HTML', .7], ['CSS', .65], ['Git', .7], ['SQL', .55], ['React', .5], ['REST APIs', .5], ['Node.js', .35], ['TypeScript', .25], ['MySQL', .3]],
        preferred: [['Docker', .55], ['AWS', .3], ['Agile', .35], ['TypeScript', .25], ['Linux', .2], ['CI/CD', .2]],
        duties: ['Develop and maintain web applications', 'Collaborate with designers and QA to ship features', 'Write clean, maintainable code and review pull requests', 'Fix bugs reported by users']
    },
    'IT Support Specialist': {
        titles: ['IT Support Specialist', 'Help Desk Technician', 'Desktop Support Engineer', 'Network Technician', 'IT Specialist'],
        must: { 'Network Technician': ['Networking'] },
        required: [['Technical Support', .85], ['Computer Hardware Troubleshooting', .8], ['Networking', .7], ['Communication', .55], ['Active Directory', .35], ['Ticketing Systems', .4], ['Windows Server', .3], ['Linux', .2], ['Customer Service', .3]],
        preferred: [['Cybersecurity', .35], ['Microsoft Azure', .2], ['AWS', .15]],
        duties: ['Respond to IT tickets from employees', 'Set up laptops, printers and accounts', 'Maintain the office network']
    },
    'Data Analyst': {
        titles: ['Junior Data Analyst', 'Reporting Analyst', 'Business Intelligence Analyst', 'Data Analyst'],
        must: {},
        required: [['SQL', .9], ['Microsoft Excel', .85], ['Data Analysis', .7], ['Power BI', .55], ['Data Visualization', .45], ['Statistics', .35], ['Python', .3]],
        preferred: [['Python', .35], ['Tableau', .35], ['Attention to Detail', .3]],
        duties: ['Build weekly and monthly reports', 'Clean and validate data from several systems', 'Present findings to managers']
    },
    'QA Tester': {
        titles: ['QA Tester', 'Software Tester', 'QA Analyst', 'QA Engineer (Automation)'],
        must: { 'QA Engineer (Automation)': ['Test Automation', 'Selenium'] },
        required: [['Software Testing', .95], ['Attention to Detail', .6], ['SQL', .45], ['Agile', .4], ['Test Automation', .35]],
        preferred: [['Selenium', .35], ['JavaScript', .3], ['Python', .25], ['Git', .3]],
        duties: ['Write and run test cases for new features', 'Report and track bugs', 'Join sprint planning and demos']
    },
    'Customer Service Representative': {
        titles: ['Customer Service Representative', 'Call Center Agent', 'Chat Support Representative', 'Technical Support Representative'],
        must: { 'Technical Support Representative': ['Technical Support'] },
        required: [['Customer Service', .95], ['Communication', .9], ['English Proficiency', .8], ['Typing', .45], ['CRM Software', .35], ['Problem Solving', .4]],
        preferred: [['Sales', .3], ['Microsoft Excel', .2], ['Technical Support', .2]],
        duties: ['Handle customer calls, chats and emails', 'Resolve concerns on the first contact', 'Document every interaction accurately']
    },
    'UI/UX & Graphic Designer': {
        titles: ['Graphic Designer', 'UI/UX Designer', 'Multimedia Designer', 'Junior Product Designer'],
        must: { 'UI/UX Designer': ['UI/UX Design', 'Figma'], 'Graphic Designer': ['Graphic Design'] },
        required: [['Graphic Design', .6], ['Adobe Photoshop', .6], ['Figma', .55], ['UI/UX Design', .5], ['Adobe Illustrator', .5]],
        preferred: [['HTML', .3], ['CSS', .3], ['Video Editing', .35], ['Communication', .3]],
        duties: ['Create layouts for web, social media and print', 'Design user flows and prototypes', 'Keep the brand consistent']
    },
    'Bookkeeper / Accounting Staff': {
        titles: ['Bookkeeper', 'Accounting Staff', 'Accounts Payable Associate', 'Junior Accountant', 'Payroll Associate'],
        must: { 'Payroll Associate': ['Payroll'] },
        required: [['Microsoft Excel', .85], ['Bookkeeping', .75], ['Accounting', .75], ['Taxation', .4], ['QuickBooks', .35], ['Payroll', .3], ['Attention to Detail', .5]],
        preferred: [['SAP', .3], ['Financial Reporting', .3]],
        duties: ['Record daily transactions', 'Prepare bank reconciliations', 'Assist in month-end closing']
    },
    'Digital Marketing Specialist': {
        titles: ['Digital Marketing Specialist', 'Social Media Specialist', 'SEO Specialist', 'Content Writer', 'Marketing Assistant'],
        must: { 'SEO Specialist': ['SEO'], 'Content Writer': ['Content Writing'] },
        required: [['Digital Marketing', .75], ['Social Media Management', .75], ['SEO', .5], ['Content Writing', .5], ['Google Analytics', .45], ['Communication', .5]],
        preferred: [['Graphic Design', .35], ['Email Marketing', .35], ['Market Research', .25]],
        duties: ['Plan and publish content calendars', 'Grow followers and engagement', 'Track campaign performance']
    },
    'Administrative Assistant': {
        titles: ['Administrative Assistant', 'Office Assistant', 'Virtual Assistant', 'Data Encoder'],
        must: { 'Data Encoder': ['Data Entry', 'Typing'] },
        required: [['Microsoft Office', .7], ['Communication', .65], ['Data Entry', .5], ['Microsoft Excel', .45], ['Records Management', .4], ['Scheduling', .4], ['Attention to Detail', .4]],
        preferred: [['Google Workspace', .35], ['Bookkeeping', .2], ['Typing', .25]],
        duties: ['Manage schedules and correspondence', 'Maintain files and records', 'Prepare reports and documents']
    }
}
const COUNT = {
    'Web Developer': 11, 'IT Support Specialist': 8, 'Data Analyst': 7, 'QA Tester': 5, 'Customer Service Representative': 9,
    'UI/UX & Graphic Designer': 5, 'Bookkeeper / Accounting Staff': 6, 'Digital Marketing Specialist': 6, 'Administrative Assistant': 6
}

const COMPANIES = ['Bayanihan Digital Solutions', 'Luzon Data Works', 'Kalayaan Outsourcing Services', 'Tala Health Systems',
    'Mabuhay Retail Group', 'Sinag Creative Studio', 'Daluyong Fintech', 'Banwa Software Labs', 'Habi Logistics Co.',
    'Agila Accounting Partners', 'Lakbay Travel Tech', 'Tanaw Analytics', 'Bituin Contact Solutions', 'Pandayan Manufacturing']
const LOCATIONS = ['Makati City', 'Quezon City', 'Pasig City', 'Taguig City', 'Cebu City', 'Davao City', 'Clark, Pampanga',
    'San Fernando, Pampanga', 'Iloilo City', 'Remote (Philippines)']

// The way postings phrase skills varies; this exercises the alias matching
const PHRASES = {
    'Microsoft Excel': ['MS Excel', 'Advanced Excel (pivot tables, VLOOKUP)', 'Microsoft Excel'],
    'Microsoft Office': ['MS Office applications', 'Microsoft Office'],
    'Communication': ['Excellent verbal and written communication', 'Strong communication skills'],
    'English Proficiency': ['Good command of English', 'Fluent in English'],
    'Customer Service': ['Customer service experience', 'Background in customer support'],
    'Attention to Detail': ['Detail-oriented', 'Keen eye for detail'],
    'Problem Solving': ['Problem-solving skills', 'Good troubleshooting skills'],
    'Technical Support': ['IT support or help desk experience', 'Technical support experience'],
    'Computer Hardware Troubleshooting': ['PC troubleshooting and repair', 'Hardware troubleshooting'],
    'Networking': ['Knowledge of LAN/WAN and TCP/IP', 'Computer networking'],
    'REST APIs': ['Building RESTful APIs', 'API integration'],
    'Git': ['Version control with Git', 'GitHub workflow'],
    'React': ['React.js', 'ReactJS'],
    'Node.js': ['Node.js', 'NodeJS'],
    'Data Visualization': ['Building dashboards', 'Data visualization'],
    'Software Testing': ['Writing and executing test cases', 'Manual testing'],
    'Social Media Management': ['Managing social media accounts', 'Social media marketing'],
    'Content Writing': ['Copywriting', 'Content creation'],
    'Data Entry': ['Data encoding', 'Data entry'],
    'Records Management': ['Filing and records keeping', 'Document management'],
    'Scheduling': ['Calendar management', 'Appointment setting'],
    'CRM Software': ['CRM tools such as Zendesk or Salesforce', 'CRM software'],
    'Typing': ['Typing speed of at least 40 wpm', 'Fast typist'],
    'Taxation': ['BIR compliance and tax filing', 'Tax compliance'],
    'Docker': ['Docker', 'Containers (Docker)'],
    'Agile': ['Agile/Scrum', 'Agile methodology']
}

// Deterministic randomness, so every seed produces the same data
let seed = 20261026
const rand = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const phrase = (skill) => pick(PHRASES[skill] ?? [skill])

const buildPosting = (occupation, profile, i) => {
    const title = profile.titles[i % profile.titles.length]
    const required = new Set(profile.must[title] ?? [])
    for(const [s, p] of profile.required) if(rand() < p) required.add(s)
    // Every posting asks for at least three things
    for(const [s] of profile.required){ if(required.size >= 3) break; required.add(s) }
    const preferred = profile.preferred.map(([s, p]) => rand() < p ? s : null).filter(s => s && !required.has(s))

    const company = pick(COMPANIES)
    const req = [...required].map(phrase)
    const pref = preferred.map(phrase)
    const style = i % 3

    let description
    if(style === 0){
        description = [
            'About us', `${company} is a growing company serving clients across the Philippines.`, '',
            'Responsibilities', ...profile.duties.map(d => `- ${d}`), '',
            'Qualifications:', '- Graduate of any related 4-year course', ...req.map(r => `- ${r}`), '',
            ...(pref.length ? ['Preferred Qualifications', ...pref.map(p => `- ${p}`), ''] : []),
            'Benefits', '- HMO from day one', '- Free training and Docker workshops', '- Hybrid work setup'
        ].join('\n')
    }else if(style === 1){
        const last = req.pop()
        description = `We are hiring a ${title} to join our team in ${pick(LOCATIONS)}. ` +
            `${profile.duties[0]}. Must have ${req.length ? req.join(', ') + ' and ' : ''}${last}. ` +
            (pref.length ? `${pref.join(' and ')} ${pref.length > 1 ? 'are' : 'is'} a plus. ` : '') +
            'Fresh graduates are welcome to apply.'
    }else{
        // As it would arrive from a partner feed: HTML
        description = `<p>Join ${company} as our next ${title}!</p>` +
            `<h3>What you'll do</h3><ul>${profile.duties.map(d => `<li>${d}</li>`).join('')}</ul>` +
            `<h3>What you'll need</h3><ul>${req.map(r => `<li>${r}</li>`).join('')}</ul>` +
            (pref.length ? `<h3>Nice to have</h3><ul>${pref.map(p => `<li>${p}</li>`).join('')}</ul>` : '') +
            `<h3>Perks</h3><ul><li>Paid AWS certification</li><li>13th month pay</li></ul>`
    }

    const daysAgo = Math.floor(rand() * 150)
    return {
        externalId: `${occupation.slice(0, 3).toUpperCase()}-${1000 + i}`,
        title, company,
        location: pick(LOCATIONS),
        description,
        postedAt: new Date(Date.now() - daysAgo * 86400000).toISOString()
    }
}

// ---------------------------------------------------------------- students
// [name, email, school, program, courses ('all' | count of first N), certifications, projects, self skills]
const STUDENTS = [
    ['Ana Reyes', 'ana', 'PSI', 'BSIT', 'all', [], [['Barangay clinic booking app', 'Built a clinic appointment booking web app using React and Node.js with Express, a MySQL database and REST APIs. Deployed with Docker and versioned on GitHub.']], ['TypeScript']],
    ['Ben Santos', 'ben', 'PSI', 'BSIT', 6, [], [], []],
    ['Carla Mendoza', 'carla', 'PSI', 'BSIT', 'all', ['Computer Systems Servicing NC II'], [], ['Active Directory', 'Ticketing Systems']],
    ['Dan Villanueva', 'dan', 'PSI', 'BSIT', 'all', ['Data Analytics Certificate (online course)'], [['Enrollment dashboard', 'Analyzed enrollment data with SQL and built Power BI dashboards for the registrar, with statistical analysis of dropout trends.']], []],
    ['Ella Garcia', 'ella', 'PSI', 'BSIT', 'all', ['Visual Graphic Design NC III'], [], []],
    ['Franco Lim', 'franco', 'PSI', 'BSIT', 'all', [], [], []],
    ['Gabriel Cruz', 'gabriel', 'SIPC', 'BSIT', 'all', [], [], []],
    ['Hannah Torres', 'hannah', 'SIPC', 'BSIT', 'all', ['Computer Systems Servicing NC II'], [], []],
    ['Ivan Ramos', 'ivan', 'SIPC', 'BSIT', 'all', [], [['Self-taught portfolio', 'Personal portfolio built with JavaScript and React, hosted on GitHub Pages.']], []],
    ['Jasmine Aquino', 'jasmine', 'SIPC', 'BSIT', 4, [], [], []],
    ['Kevin Bautista', 'kevin', 'PSI', 'BSBA-MM', 'all', ['Contact Center Services NC II'], [], []],
    ['Lea Navarro', 'lea', 'PSI', 'BSBA-MM', 'all', [], [['Cafe social media campaign', 'Ran social media marketing and copywriting for a local cafe, tracked results in Google Analytics and improved SEO of their site.']], []],
    ['Miguel Castillo', 'miguel', 'PSI', 'BSBA-MM', 3, [], [], []],
    ['Nina Fernandez', 'nina', 'PSI', 'BSAIS', 'all', ['Bookkeeping NC III'], [], ['Payroll']],
    ['Oscar Dizon', 'oscar', 'PSI', 'BSAIS', 'all', [], [], []],
    ['Paula Soriano', 'paula', 'SIPC', 'BSOA', 'all', [], [], ['Data Entry']],
    ['Quincy Manalo', 'quincy', 'SIPC', 'BSOA', 'all', ['Contact Center Services NC II'], [], []]
]

// ---------------------------------------------------------------- main
const main = async () => {
    console.log('Clearing existing data...')
    for(const model of ['jobSkill', 'jobPosting', 'importRun', 'jobSource', 'studentSkill', 'project', 'user',
        'courseSkill', 'course', 'programOccupation', 'program', 'school', 'certificationSkill', 'certification',
        'resourceSkill', 'learningResource', 'occupation']){
        await prisma[model].deleteMany()
    }
    await prisma.skill.updateMany({ data: { parentId: null } })
    await prisma.skill.deleteMany()

    // Skills (parents first, so the second pass can link them)
    const skillId = {}
    for(const [name, category, aliases] of SKILLS){
        skillId[name] = (await prisma.skill.create({ data: { name, category, aliases } })).id
    }
    for(const [name, , , parent] of SKILLS){
        if(parent) await prisma.skill.update({ where: { id: skillId[name] }, data: { parentId: skillId[parent] } })
    }
    const ids = (names) => names.map(n => {
        if(!skillId[n]) throw new Error(`Seed refers to unknown skill "${n}"`)
        return skillId[n]
    })

    const occupationId = {}
    for(const [title, titleKeywords] of Object.entries(OCCUPATIONS)){
        occupationId[title] = (await prisma.occupation.create({ data: { title, titleKeywords } })).id
    }

    const programByKey = {}
    for(const s of SCHOOLS){
        const school = await prisma.school.create({ data: { code: s.code, name: s.name } })
        for(const p of s.programs){
            const program = await prisma.program.create({
                data: {
                    schoolId: school.id, code: p.code, name: p.name,
                    occupations: { create: p.occupations.map(o => ({ occupationId: occupationId[o] })) }
                }
            })
            const courses = []
            for(const [code, title, skills] of p.courses){
                courses.push(await prisma.course.create({
                    data: { programId: program.id, code, title, skills: { create: ids(skills).map(id => ({ skillId: id })) } }
                }))
            }
            programByKey[`${s.code}/${p.code}`] = { program, school, courses }
        }
    }

    const certByName = {}
    for(const [name, issuer, skills] of CERTIFICATIONS){
        certByName[name] = await prisma.certification.create({
            data: { name, issuer, skills: { create: ids(skills).map(id => ({ skillId: id })) } }
        })
    }

    for(const [title, provider, url, hours, skills] of RESOURCES){
        await prisma.learningResource.create({
            data: { title, provider, url, hours, free: true, skills: { create: ids(skills).map(id => ({ skillId: id })) } }
        })
    }

    // Postings go through the real ingestion pipeline: normalize, dedupe, extract, classify
    invalidateTaxonomy()
    const postings = []
    let i = 0
    for(const [occupation, profile] of Object.entries(PROFILES)){
        for(let n = 0; n < COUNT[occupation]; n++) postings.push(buildPosting(occupation, profile, i++))
    }
    // Two postings outside every occupation, to show "unclassified"
    postings.push({ title: 'Warehouse Supervisor', company: 'Habi Logistics Co.', location: 'Clark, Pampanga', description: 'Supervise warehouse staff. Microsoft Excel and leadership experience required.', postedAt: new Date().toISOString() })
    postings.push({ title: 'Delivery Rider', company: 'Habi Logistics Co.', location: 'Quezon City', description: 'Deliver parcels on time. Customer service attitude is a plus.', postedAt: new Date().toISOString() })

    const fair = await ingest('peso-jobfair-2026-10', postings.slice(0, 40))
    const feed = await ingest('partner-feed-demo', [
        ...postings.slice(40),
        { ...postings[3] } // the same posting arriving through a second channel
    ])

    // People
    const password = await bcrypt.hash(DEMO_PASSWORD, 10)
    await prisma.user.create({ data: { name: 'Platform Admin', email: 'admin@skillbridge.local', password, role: 'ADMIN' } })
    for(const [code, email] of [['PSI', 'career@psi.edu.local'], ['SIPC', 'career@sipc.edu.local']]){
        const school = Object.values(programByKey).find(p => p.school.code === code).school
        await prisma.user.create({ data: { name: `${code} Career Office`, email, password, role: 'SCHOOL_ADMIN', schoolId: school.id } })
    }

    for(const [name, handle, schoolCode, programCode, courseCount, certs, projects, self] of STUDENTS){
        const { program, school, courses } = programByKey[`${schoolCode}/${programCode}`]
        const user = await prisma.user.create({
            data: { name, email: `${handle}@student.local`, password, role: 'STUDENT', schoolId: school.id, programId: program.id }
        })
        const taken = courseCount === 'all' ? courses : courses.slice(0, courseCount)
        const rows = []
        for(const c of taken){
            const cs = await prisma.courseSkill.findMany({ where: { courseId: c.id } })
            rows.push(...cs.map(x => ({ userId: user.id, skillId: x.skillId, source: 'COURSE', evidence: c.code })))
        }
        for(const certName of certs){
            const cs = await prisma.certificationSkill.findMany({ where: { certificationId: certByName[certName].id } })
            rows.push(...cs.map(x => ({ userId: user.id, skillId: x.skillId, source: 'CERTIFICATE', evidence: certName })))
        }
        for(const [title, description] of projects){
            await prisma.project.create({ data: { userId: user.id, title, description } })
            const { getTaxonomy } = await import('../src/services/taxonomyCache.js')
            const { extractSkills } = await import('../src/services/skillExtractor.js')
            const found = extractSkills(description, (await getTaxonomy()).matcher)
            rows.push(...found.map(f => ({ userId: user.id, skillId: f.skillId, source: 'PROJECT', evidence: title })))
        }
        rows.push(...ids(self).map(id => ({ userId: user.id, skillId: id, source: 'SELF', evidence: '' })))
        await prisma.studentSkill.createMany({ data: rows, skipDuplicates: true })
    }

    // The demo history is not news: only postings arriving after the seed send alerts
    await prisma.jobPosting.updateMany({ data: { notifiedAt: new Date() } })

    const classified = await prisma.jobPosting.count({ where: { occupationId: { not: null } } })
    const total = await prisma.jobPosting.count()
    console.log(`Seeded ${SKILLS.length} skills, ${Object.keys(OCCUPATIONS).length} occupations, ${SCHOOLS.length} schools, ${STUDENTS.length} students.`)
    console.log(`Imported postings: job fair ${fair.created} created; partner feed ${feed.created} created, ${feed.duplicates} duplicate. ${classified}/${total} classified.`)
    console.log(`\nDemo logins (password: ${DEMO_PASSWORD})`)
    console.log('  ADMIN         admin@skillbridge.local')
    console.log('  SCHOOL_ADMIN  career@psi.edu.local   (Pamantasan ng San Isidro)')
    console.log('  SCHOOL_ADMIN  career@sipc.edu.local  (San Isidro Polytechnic College)')
    console.log('  STUDENT       ana@student.local (BSIT, strong web dev), franco@ (BSIT, courses only), kevin@ (BSBA, call center NC II) ...')
}

main()
    .catch((err) => {
        console.error(err)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
