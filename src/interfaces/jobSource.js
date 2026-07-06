'use strict';

// Strategy interface — every job board implements source_name + search().
class JobSource {
  get sourceName() {
    throw new Error('JobSource subclasses must implement sourceName');
  }

  // eslint-disable-next-line no-unused-vars
  async search(role, location, pages = 2) {
    throw new Error('JobSource subclasses must implement search()');
  }
}

module.exports = { JobSource };
