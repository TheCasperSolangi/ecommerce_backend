const express = require('express');
const qnaController = require('../controllers/qnaController');
const authenticate  = require('../middleware/authenticate');
const authorize     = require('../middleware/authorize');

const router = express.Router();

// Staff roles that can answer questions.
const ANSWER_ROLES = ['admin', 'customer_support', 'marketing'];

// ── Public — read ─────────────────────────────────────────────────────────────
// GET /api/qna/:productId           — all Q&A for a product
// GET /api/qna/question/:id         — single question detail
//
// Named routes must come BEFORE /:productId to avoid param collision.
router.get('/question/:id', qnaController.getQuestion);
router.get('/:productId',   qnaController.getProductQnA);

// ── Authenticated — ask + edit own question ───────────────────────────────────
router.use(authenticate);

// POST /api/qna                     — ask a question (any logged-in user)
router.post('/', qnaController.askQuestion);

// PATCH /api/qna/:id                — edit own question (blocked once answered)
router.patch('/:id', qnaController.updateQuestion);

// ── Staff — answer + manage ───────────────────────────────────────────────────
// POST  /api/qna/:id/answer         — answer a question
// PATCH /api/qna/:id/answer         — edit an existing answer (is_answer_edited flagged)
router.post('/:id/answer',  authorize(...ANSWER_ROLES), qnaController.answerQuestion);
router.patch('/:id/answer', authorize(...ANSWER_ROLES), qnaController.updateAnswer);

// GET   /api/qna/admin/all          — admin list with full filters
// DELETE /api/qna/:id               — soft-delete (admin only)
router.get('/admin/all', authorize('admin'), qnaController.adminGetAllQnA);
router.delete('/:id',    authorize('admin'), qnaController.adminDeleteQuestion);

module.exports = router;
