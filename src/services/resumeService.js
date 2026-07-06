'use strict';

const { generatePdf } = require('../resume/generator');

class ResumeService {
  constructor(customizer) {
    this._customizer = customizer;
  }

  async buildForJob(profile, job) {
    console.log(`[Resume] Customizing for ${job.company} — ${job.title}`);
    const customized = await this._customizer.customize(
      profile, job.title, job.company, job.description
    );
    let slug = `${job.company}_${job.title}_${job.id}`.replace(/[^a-z0-9_]/gi, '_');
    slug = slug.replace(/_+/g, '_').slice(0, 60);
    const pdfPath = await generatePdf(customized, slug);
    console.log(`[Resume] PDF saved → ${pdfPath}`);
    return [customized, pdfPath];
  }
}

module.exports = { ResumeService };
