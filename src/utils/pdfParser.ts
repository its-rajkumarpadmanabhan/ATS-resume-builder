import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth';
import type { ResumeData } from '../types/resume';
import { SAMPLE_RESUME_DATA } from './storage';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

interface ParsedLine {
  text: string;
  headerHint: boolean;
  size?: number;
  bold?: boolean;
}

export async function extractPdfLines(file: File): Promise<ParsedLine[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const lines: ParsedLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const rows: Record<string, any[]> = {};
    
    textContent.items.forEach((item: any) => {
      if (!item.str || !item.str.trim()) return;
      const y = item.transform[5];
      const size = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 10;
      const bold = /bold|black|heavy|semibold/i.test(item.fontName || '');
      const key = Math.round(y / 3) * 3;
      if (!rows[key]) rows[key] = [];
      rows[key].push({ str: item.str, x: item.transform[4], size, bold });
    });
    
    const keys = Object.keys(rows).map(Number).sort((a, b) => b - a);
    keys.forEach(k => {
      const items = rows[k].sort((a, b) => a.x - b.x);
      const text = items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const maxSize = Math.max(...items.map(it => it.size));
      const boldCount = items.filter(it => it.bold).length;
      lines.push({ text, size: maxSize, bold: boldCount >= items.length / 2, headerHint: false });
    });
    lines.push({ text: '', headerHint: false }); // Page break
  }

  const sizes = lines.filter(l => l.text).map(l => l.size!).filter(Boolean).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;

  lines.forEach(l => {
    if (!l.text) { l.headerHint = false; return; }
    const wordCount = l.text.split(/\s+/).length;
    l.headerHint = (l.size! >= median * 1.15 || !!l.bold) && wordCount <= 7 && !/[.:]$/.test(l.text);
  });

  return lines;
}

export async function extractDocxLines(file: File): Promise<ParsedLine[]> {
  const buf = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  const lines: ParsedLine[] = [];

  function walk(node: any) {
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)){
      const t = node.textContent.trim();
      if (t) lines.push({ text: t, headerHint: true, bold: true });
    } else if (tag === 'p'){
      const t = node.textContent.trim();
      if (!t){ lines.push({ text:'', headerHint:false }); return; }
      const kids = Array.from(node.children) as HTMLElement[];
      const isFullyBold = kids.length > 0 &&
        kids.every(c => ['strong','b'].includes(c.tagName.toLowerCase())) &&
        node.textContent.trim() === kids.map(c => c.textContent).join('').trim();
      const wordCount = t.split(/\s+/).length;
      lines.push({ text: t, headerHint: isFullyBold && wordCount <= 6 && !/[.,;:]$/.test(t), bold: isFullyBold });
    } else if (tag === 'ul' || tag === 'ol'){
      Array.from(node.querySelectorAll('li')).forEach((li: any) => {
        const t = li.textContent.trim();
        if (t) lines.push({ text: '- ' + t, headerHint:false });
      });
    } else if (tag === 'table'){
      Array.from(node.querySelectorAll('tr')).forEach((tr: any) => {
        const cells = Array.from(tr.querySelectorAll('td,th')).map((td: any) => td.textContent.trim()).filter(Boolean);
        if (cells.length) lines.push({ text: cells.join('   '), headerHint:false });
      });
    } else if (node.childNodes.length){
      Array.from(node.childNodes).forEach(walk);
    } else {
      const t = node.textContent.trim();
      if (t) lines.push({ text: t, headerHint:false });
    }
  }
  Array.from(doc.body.childNodes).forEach(walk);
  return lines;
}

const parseDateRange = (text: string) => {
  const dateTermSource = /(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)|(?:(?:0?[1-9]|1[0-2])[\/\-]))?(?:19|20)\d{2}/.source;
  const rangeRegex = new RegExp(`(${dateTermSource})\\s*(?:-|–|—|−|to)\\s*(present|current|now|till now|${dateTermSource})`, 'i');
  
  const match = text.match(rangeRegex);
  if (match) {
    return {
      startDate: match[1].trim(),
      endDate: match[2].trim(),
      fullMatch: match[0]
    };
  }

  // Fallback for single dates (like graduation year)
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

function chunkEntries(lines: string[]) {
  const blocks: any[] = [];
  let currentBlock: { headerLines: string[], dates: any, descriptionLines: string[] } | null = null;
  let pendingHeaders: string[] = [];
  let prevWasEmpty = false;
  
  for (const line of lines) {
    if (!line.trim()) {
      prevWasEmpty = true;
      continue;
    }
    
    const dateRange = parseDateRange(line);
    const isBullet = /^[-*•‣◦▪●○·–—]/.test(line);
    
    // Split if we find a date, OR if there's a paragraph break (blank line) followed by a non-bullet line (and we already have a block with content)
    if (dateRange || (prevWasEmpty && !isBullet && currentBlock && (currentBlock.descriptionLines.length > 0 || currentBlock.headerLines.length >= 2))) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      
      if (dateRange) {
        const remainingLine = line.replace(dateRange.fullMatch, '').replace(/^[|,\-–—()]+\s*/,'').replace(/[|,\-–—()]+\s*$/,'').trim();
        currentBlock = {
          headerLines: [...pendingHeaders, remainingLine].filter(l => l.trim().length > 0),
          dates: dateRange,
          descriptionLines: []
        };
        pendingHeaders = [];
      } else {
        currentBlock = {
          headerLines: [...pendingHeaders, line].filter(l => l.trim().length > 0),
          dates: null,
          descriptionLines: []
        };
        pendingHeaders = [];
      }
    } else {
      if (currentBlock) {
        currentBlock.descriptionLines.push(line);
      } else {
        pendingHeaders.push(line);
      }
    }
    prevWasEmpty = false;
  }
  
  if (currentBlock) blocks.push(currentBlock);
  if (blocks.length === 0 && pendingHeaders.length > 0) {
    blocks.push({ headerLines: pendingHeaders, dates: null, descriptionLines: [] });
  }
  return blocks;
}

export async function parseResumeFile(file: File): Promise<ResumeData> {
  const isDocx = file.name.toLowerCase().endsWith('.docx');
  const parsedLines = isDocx ? await extractDocxLines(file) : await extractPdfLines(file);
  
  const data: ResumeData = JSON.parse(JSON.stringify(SAMPLE_RESUME_DATA));
  
  data.personalInfo = {
    name: '', title: '', summary: '', email: '', phone: '', location: '', website: '', socialLinks: [], customFields: []
  };
  data.experience = [];
  data.education = [];
  data.skills = [];
  data.projects = [];
  data.customSections = [];

  const rawLines = parsedLines.map(l => l.text);
  const lines = rawLines.filter(l => l.length > 0);
  
  const nameLine = lines.find(l => 
    /[a-zA-Z]{3,}/.test(l) && !l.includes('@') && !/\d/.test(l) && !/resume|curriculum vitae|cv/i.test(l)
  );
  if (nameLine) {
    data.personalInfo.name = nameLine.split(' ').slice(0, 3).join(' ').replace(/[^a-zA-Z\s\-]/g, '');
  }

  let currentSection = 'summary';
  let sectionContent: Record<string, string[]> = {
    summary: [], experience: [], education: [], skills: [], projects: []
  };

  const sectionHeaders = [
    { key: 'experience', match: /(experience|employment|work history)/i },
    { key: 'education', match: /(education|academic)/i },
    { key: 'skills', match: /(skills|technologies|core competencies)/i },
    { key: 'projects', match: /(projects|portfolio)/i }
  ];

  for (let i = 0; i < parsedLines.length; i++) {
    const lineObj = parsedLines[i];
    const line = lineObj.text;
    
    if (!line) {
      sectionContent[currentSection].push('');
      continue;
    }

    let matchedHeader = false;
    for (const header of sectionHeaders) {
      if (line.length < 40 && header.match.test(line)) {
        currentSection = header.key;
        matchedHeader = true;
        break;
      }
    }
    
    // Typography fallback for headers if it doesn't match standard regex
    if (!matchedHeader && lineObj.headerHint && line.length < 45 && !line.includes('@')) {
       // We can dynamically add custom sections here in the future.
       // For now, if it's a structural header we don't recognize, we can either ignore it or push it.
       // The typography hint is incredibly useful for structure mapping.
    }
    
    if (!matchedHeader) {
      sectionContent[currentSection].push(line);
    }
  }

  const summaryLines = sectionContent.summary.filter(l => l.length > 0);
  const actualSummary: string[] = [];

  for (let i = 0; i < summaryLines.length; i++) {
    let line = summaryLines[i];
    const originalLine = line;
    
    if (nameLine && line === nameLine) continue;

    let hasContactInfo = false;

    const emailMatch = line.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) {
      if (!data.personalInfo.email) data.personalInfo.email = emailMatch[0];
      line = line.replace(emailMatch[0], '');
      hasContactInfo = true;
    }

    const phoneMatch = line.match(/(?:\+?[0-9]{1,3}[\s.-]?)?\(?[0-9]{2,4}\)?[\s.-]?[0-9]{3,4}[\s.-]?[0-9]{3,4}/);
    if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 10) {
      if (!data.personalInfo.phone) data.personalInfo.phone = phoneMatch[0];
      line = line.replace(phoneMatch[0], '');
      hasContactInfo = true;
    }
    
    const linkMatch = line.match(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|[a-zA-Z0-9-]+\.(?:me|dev|io))(?:\/[^\s]*)?/i);
    if (linkMatch) {
       if (!data.personalInfo.website) data.personalInfo.website = linkMatch[0];
       line = line.replace(linkMatch[0], '');
       hasContactInfo = true;
    }

    const locationMatch = line.match(/\b([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})\b/);
    if (locationMatch && !data.personalInfo.location) {
       data.personalInfo.location = locationMatch[0];
       line = line.replace(locationMatch[0], '');
       hasContactInfo = true;
    } else if (line.length < 30 && line.includes(',') && !/\d/.test(line) && !data.personalInfo.location) {
       data.personalInfo.location = line.trim();
       line = '';
       hasContactInfo = true;
    }

    const stripped = line.replace(/[|•,\-–\s]/g, '');
    if (hasContactInfo && stripped.length < 15) continue;

    if (!hasContactInfo && i <= 4 && originalLine.length < 40 && !data.personalInfo.title) {
       data.personalInfo.title = originalLine.replace(/[|•]/g, '').trim();
       continue;
    }

    if (stripped.length > 0) {
      actualSummary.push(originalLine);
    }
  }

  data.personalInfo.summary = actualSummary.filter(l => l.replace(/[|•\s-]/g, '').length > 0).join(' ').substring(0, 1000);

  const expChunks = chunkEntries(sectionContent.experience);
  if (expChunks.length > 0 && (expChunks.length > 1 || expChunks[0].dates || expChunks[0].headerLines.length > 0)) {
    data.experience = expChunks.map(block => {
      let position = block.headerLines[0] || 'Unknown Position';
      let company = block.headerLines[1] || '';
      
      if (block.headerLines.length === 1) {
        const parts = block.headerLines[0].split(/\s*[|\-–,]\s*/);
        if (parts.length >= 2) {
          position = parts[0].trim();
          company = parts[1].trim();
        }
      }

      return {
        id: crypto.randomUUID(), company, position, startDate: block.dates?.startDate || '', endDate: block.dates?.endDate || '', location: '', description: block.descriptionLines.join('\n').trim(), customFields: []
      };
    });
  } else if (sectionContent.experience.length > 0) {
    data.experience.push({
      id: crypto.randomUUID(), company: 'Extracted Experience', position: '', startDate: '', endDate: '', location: '', description: sectionContent.experience.join('\n').trim(), customFields: []
    });
  }

  const eduChunks = chunkEntries(sectionContent.education);
  if (eduChunks.length > 0 && (eduChunks.length > 1 || eduChunks[0].dates || eduChunks[0].headerLines.length > 0)) {
    data.education = eduChunks.map(block => {
      let degree = block.headerLines[0] || 'Unknown Degree';
      let institution = block.headerLines[1] || '';
      
      if (block.headerLines.length === 1) {
        const parts = block.headerLines[0].split(/\s*[|\-–,]\s*/);
        if (parts.length >= 2) {
          degree = parts[0].trim();
          institution = parts[1].trim();
        }
      }

      return {
        id: crypto.randomUUID(), institution, degree, fieldOfStudy: '', startDate: block.dates?.startDate || '', endDate: block.dates?.endDate || '', location: '', description: block.descriptionLines.join('\n').trim(), customFields: []
      };
    });
  } else if (sectionContent.education.length > 0) {
    data.education.push({
      id: crypto.randomUUID(), institution: 'Extracted Education', degree: '', fieldOfStudy: '', startDate: '', endDate: '', location: '', description: sectionContent.education.join('\n').trim(), customFields: []
    });
  }

  if (sectionContent.skills.length > 0) {
    data.skills.push({
      id: crypto.randomUUID(), category: 'Extracted Skills', skills: sectionContent.skills.join(', ')
    });
  }

  if (sectionContent.projects.length > 0) {
    data.projects.push({
      id: crypto.randomUUID(), name: 'Extracted Projects', technologies: '', link: '', description: sectionContent.projects.join('\n'), customFields: []
    });
  }

  return data;
}
