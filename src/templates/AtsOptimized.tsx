import React from 'react';
import type { ResumeData, CustomSection } from '../types/resume';
import { MarkdownText } from '../components/MarkdownText';

interface TemplateProps {
  data: ResumeData;
  styleUtils: {
    fontClass: string;
    sizeClass: string;
    leadingClass: string;
    spacingClass: string;
    marginClass: string;
    accentColor: string;
    accentText: string;
    accentBorder: string;
  };
}

export const AtsOptimized: React.FC<TemplateProps> = ({ data, styleUtils }) => {
  const { personalInfo, experience, education, skills, projects, customSections, sectionOrder, styles } = data;
  const { fontClass, sizeClass, marginClass } = styleUtils;

  // Format contacts nicely
  const contacts = [
    personalInfo.email,
    personalInfo.phone,
    personalInfo.website,
    personalInfo.location,
  ].filter(Boolean);

  const customContacts = personalInfo.customFields 
    ? personalInfo.customFields.map(f => f.value).filter(Boolean) 
    : [];
  const allContacts = [...contacts, ...customContacts];

  const renderSectionHeader = (title: string) => (
    <h2 className="font-bold text-lg border-b border-black uppercase pb-1 mb-2 mt-4 text-black">
      {title}
    </h2>
  );

  const renderExperience = () => (
    <div key="experience" className="w-full">
      {renderSectionHeader('Experience')}
      <div className="space-y-4">
        {experience.map((exp) => (
          <div key={exp.id} className="w-full print:break-inside-avoid">
            <div className="font-bold text-black text-base">
              {exp.company} — {exp.location}
            </div>
            <div className="font-semibold text-black italic text-sm">
              {exp.position} | {exp.startDate} – {exp.endDate}
            </div>
            {exp.description && (
              <div className="mt-1 text-black">
                <MarkdownText text={exp.description} className="text-sm" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderEducation = () => (
    <div key="education" className="w-full">
      {renderSectionHeader('Education')}
      <div className="space-y-4">
        {education.map((edu) => (
          <div key={edu.id} className="w-full print:break-inside-avoid">
            <div className="font-bold text-black text-base">
              {edu.institution} — {edu.location}
            </div>
            <div className="font-semibold text-black italic text-sm">
              {edu.degree} in {edu.fieldOfStudy} | {edu.startDate} – {edu.endDate}
            </div>
            {edu.description && (
              <p className="mt-1 text-sm text-black">{edu.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderSkills = () => (
    <div key="skills" className="w-full">
      {renderSectionHeader('Skills')}
      <div className="space-y-1 text-sm text-black">
        {skills.map((skill) => (
          <div key={skill.id} className="mb-1">
            <strong className="text-black">{skill.category}:</strong> {skill.skills}
          </div>
        ))}
      </div>
    </div>
  );

  const renderProjects = () => (
    <div key="projects" className="w-full">
      {renderSectionHeader('Projects')}
      <div className="space-y-4">
        {projects.map((proj) => (
          <div key={proj.id} className="w-full print:break-inside-avoid">
            <div className="font-bold text-black text-base">
              {proj.name}
              {proj.link && ` — ${proj.link}`}
            </div>
            {proj.technologies && (
              <div className="font-semibold text-black italic text-sm">
                Technologies: {proj.technologies}
              </div>
            )}
            {proj.description && (
              <div className="mt-1 text-black">
                <MarkdownText text={proj.description} className="text-sm" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderCustomSection = (section: CustomSection) => (
    <div key={section.id} className="w-full">
      {renderSectionHeader(section.title)}
      <div className="space-y-4">
        {section.items.map((item) => {
          const titleField = section.fields.find(f => f.type === 'title') || section.fields[0];
          const dateField = section.fields.find(f => f.type === 'date');
          const descriptionFields = section.fields.filter(f => f.type === 'textarea');
          
          const metaFields = section.fields.filter(f => 
            f.id !== titleField?.id && 
            f.id !== dateField?.id && 
            f.type !== 'textarea'
          );

          const titleVal = titleField ? item[titleField.name] : '';
          const dateVal = dateField ? item[dateField.name] : '';

          return (
            <div key={item.id} className="w-full print:break-inside-avoid">
              <div className="font-bold text-black text-base">
                {titleVal} {dateVal && `| ${dateVal}`}
              </div>
              
              {metaFields.length > 0 && (
                <div className="text-sm text-black space-y-0.5 mt-0.5">
                  {metaFields.map(f => {
                    const val = item[f.name];
                    if (!val) return null;
                    return (
                      <div key={f.id}>
                        <strong>{f.label}:</strong> {val}
                      </div>
                    );
                  })}
                </div>
              )}

              {descriptionFields.map(f => {
                const val = item[f.name];
                if (!val) return null;
                return (
                  <div key={f.id} className="mt-1 text-black">
                    <MarkdownText text={val} className="text-sm" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderSection = (id: string) => {
    if (id === 'experience') return renderExperience();
    if (id === 'education') return renderEducation();
    if (id === 'skills') return renderSkills();
    if (id === 'projects') return renderProjects();
    
    const customSec = customSections.find(s => s.id === id);
    if (customSec) return renderCustomSection(customSec);
    return null;
  };

  return (
    <div className={`resume-paper w-full bg-white text-black shadow-lg ${fontClass} ${sizeClass} ${marginClass} font-sans leading-normal`}>
      <div className="text-center pb-4">
        <h1 className="font-bold text-2xl text-black uppercase mb-1">
          {personalInfo.name}
        </h1>
        {personalInfo.title && (
          <p className="text-lg font-semibold text-black mb-1">{personalInfo.title}</p>
        )}
        <div className="text-sm text-black">
          {allContacts.join(' | ')}
        </div>
        {personalInfo.socialLinks && personalInfo.socialLinks.length > 0 && (
          <div className="text-sm text-black mt-1">
            {personalInfo.socialLinks.map(link => link.url).join(' | ')}
          </div>
        )}
      </div>

      {personalInfo.summary && (
        <div className="mb-4">
          <MarkdownText text={personalInfo.summary} className="text-sm text-black" />
        </div>
      )}

      <div className="space-y-4">
        {sectionOrder
          .filter(id => id !== 'personalInfo' && !(styles.hiddenSections || []).includes(id))
          .map(id => renderSection(id))}
      </div>
    </div>
  );
};
