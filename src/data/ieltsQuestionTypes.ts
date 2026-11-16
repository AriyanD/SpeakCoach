/** Shared IELTS question data shapes. This module contains types only and no embedded question bank. */
export interface IeltsPart1Question {
  id: string;
  topic: string;
  question: string;
}

export interface IeltsPart2CueCard {
  id: string;
  topic: string;
  title: string;
  prompt: string;
  bullets: [string, string, string, string];
}

export interface IeltsPart3Question {
  id: string;
  cueCardId: string;
  topic: string;
  question: string;
}

export interface IeltsTestSessionPlan {
  id: string;
  part1Topics: string[];
  part1Questions: IeltsPart1Question[];
  part2CueCard: IeltsPart2CueCard;
  part3Questions: IeltsPart3Question[];
}
