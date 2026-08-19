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
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
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

  // Basic Heuristic Parsing
  // 1. Extract Email
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch) {
    data.personalInfo.email = emailMatch[0];
  }

  // 2. Extract Phone (very basic regex)
  const phoneMatch = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phoneMatch) {
    data.personalInfo.phone = phoneMatch[0];
  }

  // 3. Extract Name (guess first non-empty line with letters)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const nameLine = lines.find(l => /[a-zA-Z]{3,}/.test(l));
  if (nameLine) {
    // If the name line is huge, just take the first 3 words
    const words = nameLine.split(' ');
    data.personalInfo.name = words.slice(0, 3).join(' ');
  }

  // 4. Section Chunking
  let currentSection = 'summary';
  let sectionContent: Record<string, string[]> = {
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: []
  };

  const sectionHeaders = [
    { key: 'experience', match: /experience|employment|work history/i },
    { key: 'education', match: /education|academic/i },
    { key: 'skills', match: /skills|technologies|core competencies/i },
    { key: 'projects', match: /projects|portfolio/i }
  ];

  for (const line of lines) {
    let matchedHeader = false;
    for (const header of sectionHeaders) {
      if (line.length < 30 && header.match.test(line)) {
        currentSection = header.key;
        matchedHeader = true;
        break;
      }
    }
    
    if (!matchedHeader) {
      sectionContent[currentSection].push(line);
    }
  }

  // Map chunked text to our data structure
  
  if (sectionContent.summary.length > 3) {
    // The rest of the top part might be summary
    data.personalInfo.summary = sectionContent.summary.slice(1).join(' ').substring(0, 500);
  }

  if (sectionContent.experience.length > 0) {
    data.experience.push({
      id: crypto.randomUUID(),
      company: 'Extracted Experience',
      position: '',
      startDate: '',
      endDate: '',
      location: '',
      description: sectionContent.experience.join('\n').substring(0, 2000),
      customFields: []
    });
  }

  if (sectionContent.education.length > 0) {
    data.education.push({
      id: crypto.randomUUID(),
      institution: 'Extracted Education',
      degree: '',
      fieldOfStudy: '',
      startDate: '',
      endDate: '',
      location: '',
      description: sectionContent.education.join('\n').substring(0, 1000),
      customFields: []
    });
  }

  if (sectionContent.skills.length > 0) {
    data.skills.push({
      id: crypto.randomUUID(),
      category: 'Extracted Skills',
      skills: sectionContent.skills.join(', ').substring(0, 500)
    });
  }

  if (sectionContent.projects.length > 0) {
    data.projects.push({
      id: crypto.randomUUID(),
      name: 'Extracted Projects',
      technologies: '',
      link: '',
      description: sectionContent.projects.join('\n').substring(0, 1000),
      customFields: []
    });
  }

  return data;
}
