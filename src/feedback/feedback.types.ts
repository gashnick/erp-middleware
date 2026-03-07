// src/feedback/feedback.types.ts

export type FeedbackRating = 'helpful' | 'not_helpful';

export interface Feedback {
  id: string;
  userId: string;
  insightId: string;
  rating: FeedbackRating;
  comment?: string;
  createdAt: Date;
}
