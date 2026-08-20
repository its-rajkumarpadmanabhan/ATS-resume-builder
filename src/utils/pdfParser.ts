import * as pdfjsLib from 'pdfjs-dist';
import type { ResumeData } from '../types/resume';
import { SAMPLE_RESUME_DATA } from './storage';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    let lastY = -1;
    let pageText = '';
    
    for (const item of textContent.items as any[]) {
      if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
        pageText += '\n';
      } else if (lastY !== -1 && item.str.trim() !== '') {
        pageText += ' ';
      }
      pageText += item.str;
      lastY = item.transform[5];
    }
    fullText += pageText + '\n\n';
  }

  return fullText;
}

const parseDateRange = (text: string) => {
  const dateTermSource = /(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)|(?:(?:0?[1-9]|1[0-2])[\/\-]))?(?:19|20)\d{2}/.source;
  const rangeRegex = new RegExp(`(${dateTermSource})\\s*(?:-|–|to)\\s*(present|current|now|till now|${dateTermSource})`, 'i');
  
  const match = text.match(rangeRegex);
  if (match) {
    return {
      startDate: match[1].trim(),
      endDate: match[2].trim(),
      fullMatch: match[0]
    };
  }

  // Fallback for single dates (like graduation year), only if they are the main content of the line
  const singleDateRegex = new RegExp(`^\\s*(${dateTermSource})\\s*$`, 'i');
  const singleMatch = text.match(singleDateRegex);
  if (singleMatch && text.length < 30) {
    return {
      startDate: singleMatch[1].trim(),
      endDate: singleMatch[1].trim(),
      fullMatch: singleMatch[0]
    };
  }

  return null;
}

function chunkByDates(lines: string[]) {
  const blocks: any[] = [];
  let currentBlock: { headerLines: string[], dates: any, descriptionLines: string[] } | null = null;
  let pendingHeaders: string[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const dateRange = parseDateRange(line);
    
    if (dateRange) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      
      const remainingLine = line.replace(dateRange.fullMatch, '').trim();
      currentBlock = {
        headerLines: [...pendingHeaders, remainingLine].filter(l => l.trim().length > 0),
        dates: dateRange,
        descriptionLines: []
      };
      pendingHeaders = [];
    } else {
      if (currentBlock) {
        currentBlock.descriptionLines.push(line);
      } else {
        pendingHeaders.push(line);
      }
    }
  }
  
  if (currentBlock) blocks.push(currentBlock);
  return { blocks, unassigned: pendingHeaders };
}

export async function parsePdfResume(file: File): Promise<ResumeData> {
  const text = await extractTextFromPdf(file);
  
  // Clone the default schema to ensure we have all required fields
  const data: ResumeData = JSON.parse(JSON.stringify(SAMPLE_RESUME_DATA));
  
  data.personalInfo = {
    name: '',
    title: '',
    summary: '',
    email: '',
    phone: '',
    location: '',
    website: '',
    socialLinks: [],
    customFields: []
  };
  data.experience = [];
  data.education = [];
  data.skills = [];
  data.projects = [];
  data.customSections = [];

  // 1. Extract Name (guess first non-empty line with letters)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const nameLine = lines.find(l => 
    /[a-zA-Z]{3,}/.test(l) && 
    !l.includes('@') && 
    !/\d/.test(l) &&
    !/resume|curriculum vitae|cv/i.test(l)
  );
  
  if (nameLine) {
    const words = nameLine.split(' ');
    data.personalInfo.name = words.slice(0, 3).join(' ').replace(/[^a-zA-Z\s\-]/g, '');
  }

  // 2. Section Chunking
  let currentSection = 'summary';
  let sectionContent: Record<string, string[]> = {
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: []
  };

  const sectionHeaders = [
    { key: 'experience', match: /(experience|employment|work history)/i },
    { key: 'education', match: /(education|academic)/i },
    { key: 'skills', match: /(skills|technologies|core competencies)/i },
    { key: 'projects', match: /(projects|portfolio)/i }
  ];

  for (const line of lines) {
    let matchedHeader = false;
    for (const header of sectionHeaders) {
      if (line.length < 40 && header.match.test(line.trim())) {
        currentSection = header.key;
        matchedHeader = true;
        break;
      }
    }
    
    if (!matchedHeader) {
      sectionContent[currentSection].push(line);
    }
  }

  // 3. Contact & Summary Parsing
  const summaryLines = sectionContent.summary;
  const actualSummary: string[] = [];

  for (let i = 0; i < summaryLines.length; i++) {
    const line = summaryLines[i];
    
    // Skip name line
    if (nameLine && line === nameLine) {
        continue;
    }

    let isContactInfo = false;

    // Check for email
    const emailMatch = line.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) {
      if (!data.personalInfo.email) data.personalInfo.email = emailMatch[0];
      const stripped = line.replace(emailMatch[0], '').replace(/[|•,]/g, '').trim();
      if (stripped.length < 5) isContactInfo = true;
    }

    // Check for phone
    const phoneMatch = line.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (phoneMatch) {
      if (!data.personalInfo.phone) data.personalInfo.phone = phoneMatch[0];
      const stripped = line.replace(phoneMatch[0], '').replace(/[|•,]/g, '').trim();
      if (stripped.length < 5) isContactInfo = true;
    }
    
    // Check for Links (LinkedIn, GitHub, etc.)
    if (/linkedin\.com|github\.com|\.me|\.dev|\.io/i.test(line)) {
       if (!data.personalInfo.website) {
         data.personalInfo.website = line.replace(/[|•]/g, '').trim();
       }
       isContactInfo = true;
    }

    // Check for Location (City, State format on short lines)
    if (!isContactInfo && line.length < 30 && line.includes(',') && !/\d/.test(line) && !data.personalInfo.location) {
       data.personalInfo.location = line.replace(/[|•]/g, '').trim();
       isContactInfo = true;
    }

    // If it's a short line right below the name and has no contact info, it's likely the Job Title
    if (!isContactInfo && i <= 4 && line.length < 40 && !data.personalInfo.title) {
       data.personalInfo.title = line.replace(/[|•]/g, '').trim();
       isContactInfo = true;
    }

    // If it wasn't matched as an isolated contact field, it belongs in the summary paragraph
    if (!isContactInfo) {
      actualSummary.push(line);
    }
  }

  // Clean up the actual summary
  data.personalInfo.summary = actualSummary
    .filter(l => l.replace(/[|•\s-]/g, '').length > 0)
    .join(' ')
    .substring(0, 1000);

  // Experience Parsing
  const expChunks = chunkByDates(sectionContent.experience);
  if (expChunks.blocks.length > 0) {
    data.experience = expChunks.blocks.map(block => {
      let position = block.headerLines[0] || 'Unknown Position';
      let company = block.headerLines[1] || '';
      
      // If there's only 1 header line, try to split by common separators (e.g. "Software Engineer - Google")
      if (block.headerLines.length === 1) {
        const parts = block.headerLines[0].split(/\s*[|\-–,]\s*/);
        if (parts.length >= 2) {
          position = parts[0];
          company = parts[1];
        }
      }

      return {
        id: crypto.randomUUID(),
        company,
        position,
        startDate: block.dates.startDate,
        endDate: block.dates.endDate,
        location: '',
        description: block.descriptionLines.join('\n').trim(),
        customFields: []
      };
    });
  } else if (sectionContent.experience.length > 0) {
    data.experience.push({
      id: crypto.randomUUID(),
      company: 'Extracted Experience',
      position: '',
      startDate: '',
      endDate: '',
      location: '',
      description: sectionContent.experience.join('\n'),
      customFields: []
    });
  }

  // Education Parsing
  const eduChunks = chunkByDates(sectionContent.education);
  if (eduChunks.blocks.length > 0) {
    data.education = eduChunks.blocks.map(block => {
      let degree = block.headerLines[0] || 'Unknown Degree';
      let institution = block.headerLines[1] || '';
      
      if (block.headerLines.length === 1) {
        const parts = block.headerLines[0].split(/\s*[|\-–,]\s*/);
        if (parts.length >= 2) {
          degree = parts[0];
          institution = parts[1];
        }
      }

      return {
        id: crypto.randomUUID(),
        institution,
        degree,
        fieldOfStudy: '',
        startDate: block.dates.startDate,
        endDate: block.dates.endDate,
        location: '',
        description: block.descriptionLines.join('\n').trim(),
        customFields: []
      };
    });
  } else if (sectionContent.education.length > 0) {
    data.education.push({
      id: crypto.randomUUID(),
      institution: 'Extracted Education',
      degree: '',
      fieldOfStudy: '',
      startDate: '',
      endDate: '',
      location: '',
      description: sectionContent.education.join('\n'),
      customFields: []
    });
  }

  if (sectionContent.skills.length > 0) {
    data.skills.push({
      id: crypto.randomUUID(),
      category: 'Extracted Skills',
      skills: sectionContent.skills.join(', ')
    });
  }

  if (sectionContent.projects.length > 0) {
    data.projects.push({
      id: crypto.randomUUID(),
      name: 'Extracted Projects',
      technologies: '',
      link: '',
      description: sectionContent.projects.join('\n'),
      customFields: []
    });
  }

  return data;
}
