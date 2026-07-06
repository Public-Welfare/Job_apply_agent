'use strict';

// Strategy interface — swap the LLM behind resume tailoring.
class ResumeCustomizer {
  // eslint-disable-next-line no-unused-vars
  async customize(profile, jobTitle, company, jobDescription) {
    throw new Error('ResumeCustomizer subclasses must implement customize()');
  }
}

module.exports = { ResumeCustomizer };
