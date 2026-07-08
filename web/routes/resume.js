'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { config } = require('../../src/config');
const { importResume } = require('../../src/resume/latexImporter');
const { requireAuth } = require('../auth');
const { HttpError, wrap } = require('../httpError');

// Uploads stay in memory, so cap the size (a resume is a few KB of text).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

module.exports = () => {
  const router = express.Router();

  router.post(
    '/api/resume/import',
    requireAuth,
    upload.single('file'),
    wrap(async (req, res) => {
      // Accept either pasted text (JSON { text }) or an uploaded .tex/.txt file.
      const file = req.file;
      const pasted = req.body && typeof req.body.text === 'string' ? req.body.text : '';
      let raw;
      let originName;
      if (pasted.trim()) {
        raw = pasted;
        originName = (req.body && req.body.name) || 'resume';
      } else if (file) {
        const name = file.originalname || '';
        if (!name.toLowerCase().endsWith('.tex') && !name.toLowerCase().endsWith('.txt')) {
          throw new HttpError(400, 'Please upload a LaTeX (.tex) file');
        }
        raw = file.buffer.toString('utf-8');
        originName = path.parse(name).name;
      } else {
        throw new HttpError(400, 'Paste your resume text (or upload a .tex file)');
      }
      if (!raw.trim()) throw new HttpError(400, 'Resume text is empty');
      const roles = Array.isArray(req.body && req.body.roles)
        ? req.body.roles.map((r) => String(r).trim()).filter(Boolean)
        : [];
      let result;
      try {
        result = await importResume(raw, originName, { roles });
      } catch (e) {
        throw new HttpError(500, `Import failed: ${e.message}`);
      }
      const fileUrl = (f) => `/api/resume/import/file/${f}`;
      res.json({
        name: result.name,
        base: { tex_url: fileUrl(result.base.tex_file), pdf_url: fileUrl(result.base.pdf_file) },
        variants: result.variants.map((v) => ({
          jobType: v.jobType,
          label: v.label,
          tailored: v.tailored,
          tex_url: fileUrl(v.tex_file),
          pdf_url: fileUrl(v.pdf_file),
        })),
      });
    })
  );

  router.get('/api/resume/import/list', requireAuth, (req, res) => {
    if (!fs.existsSync(config.IMPORTS_DIR)) return res.json([]);
    const grouped = {};
    for (const f of fs.readdirSync(config.IMPORTS_DIR)) {
      const ext = path.extname(f);
      if (ext === '.tex' || ext === '.pdf') {
        const stem = path.basename(f, ext);
        (grouped[stem] = grouped[stem] || {})[ext.slice(1)] = f;
      }
    }
    const out = Object.entries(grouped).map(([stem, files]) => ({
      name: stem,
      tex_url: files.tex ? `/api/resume/import/file/${files.tex}` : null,
      pdf_url: files.pdf ? `/api/resume/import/file/${files.pdf}` : null,
    }));
    out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    res.json(out);
  });

  router.get('/api/resume/import/file/:filename', requireAuth, (req, res) => {
    const safe = path.basename(req.params.filename); // block path traversal
    const p = path.join(config.IMPORTS_DIR, safe);
    if (!fs.existsSync(p)) return res.status(404).json({ detail: 'File not found' });
    return res.download(p, safe);
  });

  return router;
};
