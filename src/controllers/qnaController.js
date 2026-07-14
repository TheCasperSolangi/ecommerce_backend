const crypto = require('crypto');
const Question = require('../models/QnA');
const Product  = require('../models/Product');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateQuestionCode = () =>
  `QNA-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ---------------------------------------------------------------------------
// Public — read
// ---------------------------------------------------------------------------

/**
 * GET /api/qna/:productId
 * Returns all non-deleted Q&A for a product.
 * Unanswered questions are included so visitors see the community activity.
 * Query: ?page, ?limit, ?status (ASKED | ANSWERED)
 */
exports.getProductQnA = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const filter = { product_id: req.params.productId, is_deleted: false };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [questions, total] = await Promise.all([
    Question.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-__v -is_deleted -deleted_at'),
    Question.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      questions,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/qna/question/:id — single question detail */
exports.getQuestion = catchAsync(async (req, res) => {
  const question = await Question.findOne({
    _id:        req.params.id,
    is_deleted: false,
  }).select('-__v -is_deleted -deleted_at');

  if (!question) throw new ApiError(404, 'Question not found');
  res.status(200).json({ success: true, data: { question } });
});

// ---------------------------------------------------------------------------
// Authenticated user — ask a question
// ---------------------------------------------------------------------------

/**
 * POST /api/qna
 * Any authenticated user can ask a question on any active product.
 * Body: { product_id, question }
 */
exports.askQuestion = catchAsync(async (req, res) => {
  const { product_id, question } = req.body;

  if (!product_id) throw new ApiError(400, 'product_id is required');
  if (!question)   throw new ApiError(400, 'question is required');

  // Verify product exists and is active.
  const product = await Product.findOne({ _id: product_id, status: 'active' });
  if (!product) throw new ApiError(404, 'Product not found');

  const entry = await Question.create({
    question_code: generateQuestionCode(),
    asked_by:      req.user._id,
    asked_by_details: {
      first_name:      req.user.first_name,
      last_name:       req.user.last_name,
      profile_picture: req.user.profile_picture || null,
    },
    product_id,
    question,
    status: 'ASKED',
  });

  res.status(201).json({
    success: true,
    message: 'Question submitted successfully',
    data: { question: entry },
  });
});

// ---------------------------------------------------------------------------
// Customer — edit own question (before it is answered)
// ---------------------------------------------------------------------------

/**
 * PATCH /api/qna/:id
 * Customer may only edit the question text.
 * Editing is blocked once the question has been answered.
 * is_question_edited is set to true permanently on first edit.
 */
exports.updateQuestion = catchAsync(async (req, res) => {
  const { question: questionText } = req.body;
  if (!questionText) throw new ApiError(400, 'question text is required');

  const entry = await Question.findOne({
    _id:        req.params.id,
    asked_by:   req.user._id,
    is_deleted: false,
  });
  if (!entry) throw new ApiError(404, 'Question not found');

  // Block edits once answered — the answer may reference the original wording.
  if (entry.status === 'ANSWERED') {
    throw new ApiError(403, 'Answered questions cannot be edited');
  }

  entry.question            = questionText;
  entry.is_question_edited  = true;  // permanently flagged
  await entry.save();

  res.status(200).json({
    success: true,
    message: 'Question updated',
    data: { question: entry },
  });
});

// ---------------------------------------------------------------------------
// Staff (admin / customer_support / marketing) — answer, edit answer, manage
// ---------------------------------------------------------------------------

/**
 * POST /api/qna/:id/answer
 * Answer an ASKED question.
 * Body: { answer }
 */
exports.answerQuestion = catchAsync(async (req, res) => {
  const { answer } = req.body;
  if (!answer) throw new ApiError(400, 'answer is required');

  const entry = await Question.findOne({ _id: req.params.id, is_deleted: false });
  if (!entry) throw new ApiError(404, 'Question not found');

  if (entry.status === 'ANSWERED') {
    throw new ApiError(400, 'This question has already been answered. Use PATCH /api/qna/:id/answer to edit it.');
  }

  entry.answer      = answer;
  entry.answered_by = req.user._id;
  entry.answered_at = new Date();
  entry.status      = 'ANSWERED';
  await entry.save();

  res.status(200).json({
    success: true,
    message: 'Question answered successfully',
    data: { question: entry },
  });
});

/**
 * PATCH /api/qna/:id/answer
 * Edit an existing answer.
 * is_answer_edited is set to true permanently on first edit.
 * Body: { answer }
 */
exports.updateAnswer = catchAsync(async (req, res) => {
  const { answer } = req.body;
  if (!answer) throw new ApiError(400, 'answer is required');

  const entry = await Question.findOne({ _id: req.params.id, is_deleted: false });
  if (!entry) throw new ApiError(404, 'Question not found');

  if (entry.status !== 'ANSWERED') {
    throw new ApiError(400, 'Cannot edit an answer for an unanswered question');
  }

  entry.answer          = answer;
  entry.answered_by     = req.user._id;  // track who last edited
  entry.answered_at     = new Date();
  entry.is_answer_edited = true;         // permanently flagged
  await entry.save();

  res.status(200).json({
    success: true,
    message: 'Answer updated',
    data: { question: entry },
  });
});

/**
 * GET /api/qna/admin/all
 * Full list with filters for admin dashboard.
 * Query: ?page, ?limit, ?product_id, ?status, ?is_deleted
 */
exports.adminGetAllQnA = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, product_id, status, is_deleted } = req.query;

  const filter = {};
  if (product_id)               filter.product_id = product_id;
  if (status)                   filter.status      = status;
  if (is_deleted !== undefined) filter.is_deleted  = is_deleted === 'true';

  const skip = (Number(page) - 1) * Number(limit);
  const [questions, total] = await Promise.all([
    Question.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)).select('-__v'),
    Question.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      questions,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/**
 * DELETE /api/qna/:id  (admin only)
 * Soft-deletes a question (and its answer).
 */
exports.adminDeleteQuestion = catchAsync(async (req, res) => {
  const entry = await Question.findById(req.params.id);
  if (!entry) throw new ApiError(404, 'Question not found');
  if (entry.is_deleted) throw new ApiError(400, 'Question is already deleted');

  entry.is_deleted = true;
  entry.deleted_at = new Date();
  await entry.save();

  res.status(200).json({ success: true, message: 'Question removed successfully' });
});
