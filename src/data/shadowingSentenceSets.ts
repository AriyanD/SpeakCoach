import type { ShadowingDifficulty, ShadowingSentence } from './shadowingBank';

const EASY_CONTEXTS = [
  ['Daily life', 'a quiet morning at home'], ['Travel', 'a short trip by train'], ['Food', 'a simple meal with friends'],
  ['Learning', 'a new skill after work'], ['Community', 'a friendly neighbourhood']
] as const;
const MEDIUM_CONTEXTS = [
  ['Technology', 'the growing use of digital tools'], ['Education', 'practical learning beyond the classroom'],
  ['Environment', 'local efforts to reduce waste'], ['Work', 'a flexible approach to modern careers'],
  ['Cities', 'the changing character of urban neighbourhoods']
] as const;
const HARD_CONTEXTS = [
  ['Public policy', 'the long-term consequences of public investment'], ['Sustainability', 'the transition towards resource-conscious lifestyles'],
  ['Culture', 'the preservation of shared cultural knowledge'], ['Economics', 'the distributional effects of technological change'],
  ['Research', 'the relationship between evidence and institutional decision-making']
] as const;

const EASY_PATTERNS: Array<(subject: string) => string> = [
  s => `Spending a little time on ${s} can make the day feel more enjoyable.`,
  s => `Many people find that ${s} helps them build a healthier daily routine.`,
  s => `I prefer ${s} because it gives me a chance to slow down and think.`,
  s => `A good plan for ${s} can save time and prevent unnecessary stress.`,
  s => `We learned that ${s} is easier when everyone shares the work.`,
  s => `Even a small change to ${s} can make a noticeable difference.`,
  s => `My friends often talk about ${s} when we meet at the weekend.`,
  s => `It is useful to make time for ${s}, even on a busy day.`,
  s => `A simple conversation about ${s} can bring people closer together.`,
  s => `Children can learn important habits by taking part in ${s}.`,
  s => `I usually feel more confident when I have prepared for ${s}.`,
  s => `There are several easy ways to make ${s} more enjoyable.`,
  s => `People should have enough time to enjoy ${s} without feeling rushed.`,
  s => `Good communication makes ${s} easier for everyone involved.`,
  s => `The best thing about ${s} is the opportunity to learn something new.`,
  s => `We can make ${s} better by listening carefully to other people.`,
  s => `A little patience is often all we need to improve ${s}.`,
  s => `I would like to spend more time on ${s} in the future.`,
  s => `Keeping a positive attitude can make ${s} much less difficult.`,
  s => `Sharing useful ideas helps everyone get more out of ${s}.`
];
const MEDIUM_PATTERNS: Array<(subject: string) => string> = [
  s => `Although ${s} can require careful planning, the long-term benefits are often worth the effort.`,
  s => `People are more likely to support ${s} when they understand how it affects their daily lives.`,
  s => `One important advantage of ${s} is that it can create opportunities for people with different backgrounds.`,
  s => `If communities invest in ${s}, they may become better prepared to deal with future challenges.`,
  s => `The success of ${s} often depends on whether institutions communicate their goals clearly.`,
  s => `Rather than treating ${s} as a temporary trend, organisations should consider its lasting effects.`,
  s => `Access to reliable information allows individuals to make better decisions about ${s}.`,
  s => `While opinions about ${s} may differ, constructive discussion can reveal areas of common ground.`,
  s => `A balanced approach to ${s} should take both immediate needs and future consequences into account.`,
  s => `People sometimes underestimate how strongly ${s} can influence the quality of everyday experience.`,
  s => `By sharing responsibility for ${s}, local groups can achieve results that individuals cannot manage alone.`,
  s => `The most effective solutions to ${s} are usually adapted to the needs of the people involved.`,
  s => `Even when ${s} appears straightforward, unexpected circumstances can make implementation more complicated.`,
  s => `Public awareness of ${s} tends to improve when practical examples are discussed openly.`,
  s => `It is worth examining who benefits from ${s} and who might be left without adequate support.`,
  s => `Successful participation in ${s} requires clear expectations as well as opportunities for feedback.`,
  s => `Small improvements to ${s} can become significant when they are repeated across an entire community.`,
  s => `Decision-makers should evaluate ${s} using evidence rather than relying entirely on familiar assumptions.`,
  s => `A lack of coordination can prevent ${s} from delivering the benefits that were originally promised.`,
  s => `Understanding the wider context of ${s} helps explain why different groups may respond in different ways.`
];
const HARD_PATTERNS: Array<(subject: string) => string> = [
  s => `Unless decision-makers acknowledge the structural factors shaping ${s}, isolated improvements are unlikely to produce lasting change.`,
  s => `The apparent efficiency of ${s} should be assessed alongside its less visible social and environmental costs.`,
  s => `Although ${s} is frequently presented as an individual responsibility, its outcomes are strongly influenced by institutional conditions.`,
  s => `A credible strategy for ${s} must reconcile competing priorities without disguising the unequal distribution of costs.`,
  s => `What makes ${s} particularly challenging is the gap between short-term incentives and long-term collective interests.`,
  s => `If the assumptions underlying ${s} remain unquestioned, policy interventions may reinforce the very problems they intend to address.`,
  s => `The legitimacy of ${s} depends not merely on measurable outcomes but also on whose experiences shape the evaluation.`,
  s => `Rather than interpreting ${s} as a purely technical matter, researchers should examine its political and cultural dimensions.`,
  s => `The consequences of ${s} become especially pronounced when institutional responsibilities are fragmented across several organisations.`,
  s => `Meaningful progress on ${s} requires mechanisms through which affected communities can influence decisions, not simply respond to them.`,
  s => `Even well-intentioned reforms to ${s} can reproduce existing inequalities when access to resources remains uneven.`,
  s => `An adequate account of ${s} must consider how historical decisions constrain the choices available to present generations.`,
  s => `The debate surrounding ${s} illustrates why aggregate indicators can conceal substantial differences between social groups.`,
  s => `Without transparent accountability, commitments to improve ${s} risk becoming symbolic statements rather than practical obligations.`,
  s => `The durability of ${s} depends on whether new practices become embedded in everyday routines and organisational structures.`,
  s => `Evaluating ${s} requires attention to unintended consequences that may emerge beyond the boundaries of the original intervention.`,
  s => `A more inclusive understanding of ${s} would recognise forms of expertise that conventional institutions often overlook.`,
  s => `The relationship between ${s} and broader patterns of consumption cannot be understood through individual choice alone.`,
  s => `When responsibility for ${s} is distributed unevenly, cooperation becomes difficult without a credible framework for negotiation.`,
  s => `Ultimately, the value of ${s} should be judged by whether it expands collective capacity while respecting ecological limits.`
];

const FOCUS = [
  'Sentence stress and clear vowel sounds', 'Linking between adjacent words', 'Word stress in longer expressions',
  'Natural rhythm across clauses', 'Clear final consonants', 'Weak forms in connected speech',
  'Intonation across a complex sentence', 'Consonant clusters and articulation'
];

function buildSets(
  difficulty: ShadowingDifficulty,
  contexts: ReadonlyArray<readonly [string, string]>,
  patterns: Array<(subject: string) => string>
): ShadowingSentence[][] {
  return contexts.map(([topic, subject], setIndex) => patterns.map((makeSentence, sentenceIndex) => {
    const text = difficulty === 'easy' && setIndex === 0 && sentenceIndex === 0
      ? 'I usually start my morning with a cup of hot coffee.'
      : makeSentence(subject);
    return {
      id: `builtin-${difficulty}-set-${setIndex + 1}-${sentenceIndex + 1}`,
      difficulty,
      topic,
      text,
      phoneticFocus: FOCUS[(sentenceIndex + setIndex * 3) % FOCUS.length],
      expectedTotalDurationMs: Math.max(2600, Math.round(text.split(/\s+/).length * (difficulty === 'easy' ? 390 : difficulty === 'medium' ? 430 : 470)))
    };
  }));
}

export const BUILTIN_SHADOWING_SETS: Record<ShadowingDifficulty, ShadowingSentence[][]> = {
  easy: buildSets('easy', EASY_CONTEXTS, EASY_PATTERNS),
  medium: buildSets('medium', MEDIUM_CONTEXTS, MEDIUM_PATTERNS),
  hard: buildSets('hard', HARD_CONTEXTS, HARD_PATTERNS)
};

export function getInitialShadowingSets(difficulty: ShadowingDifficulty): ShadowingSentence[][] {
  return BUILTIN_SHADOWING_SETS[difficulty].map(set => set.map(sentence => ({ ...sentence })));
}
