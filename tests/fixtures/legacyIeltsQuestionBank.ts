import type {
  IeltsPart1Question,
  IeltsPart2CueCard,
  IeltsPart3Question,
  IeltsTestSessionPlan
} from '../../src/data/ieltsQuestionTypes';
export type {
  IeltsPart1Question,
  IeltsPart2CueCard,
  IeltsPart3Question,
  IeltsTestSessionPlan
} from '../../src/data/ieltsQuestionTypes';

export const PART_1_QUESTIONS: IeltsPart1Question[] = [
  // Topic: Hometown (5)
  { id: 'p1_ht_1', topic: 'Hometown', question: 'Where is your hometown, and can you tell me a little bit about it?' },
  { id: 'p1_ht_2', topic: 'Hometown', question: 'What do you like most about living in your hometown?' },
  { id: 'p1_ht_3', topic: 'Hometown', question: 'Has your hometown changed much since you were a child?' },
  { id: 'p1_ht_4', topic: 'Hometown', question: 'Is there anything you would like to improve about your hometown?' },
  { id: 'p1_ht_5', topic: 'Hometown', question: 'Do you plan to live in your hometown in the future?' },

  // Topic: Work & Studies (5)
  { id: 'p1_ws_1', topic: 'Work & Studies', question: 'Do you work, or are you currently studying?' },
  { id: 'p1_ws_2', topic: 'Work & Studies', question: 'Why did you choose that particular field or subject?' },
  { id: 'p1_ws_3', topic: 'Work & Studies', question: 'What is the most interesting part of your daily work or studies?' },
  { id: 'p1_ws_4', topic: 'Work & Studies', question: 'How do you usually organize your working or study hours?' },
  { id: 'p1_ws_5', topic: 'Work & Studies', question: 'What kind of job would you like to have in five years?' },

  // Topic: Daily Routine (5)
  { id: 'p1_dr_1', topic: 'Daily Routine', question: 'What is your typical morning routine like?' },
  { id: 'p1_dr_2', topic: 'Daily Routine', question: 'Do you prefer mornings or evenings for getting important tasks done?' },
  { id: 'p1_dr_3', topic: 'Daily Routine', question: 'How do your routines differ between weekdays and weekends?' },
  { id: 'p1_dr_4', topic: 'Daily Routine', question: 'Is there any part of your daily routine you would like to change?' },
  { id: 'p1_dr_5', topic: 'Daily Routine', question: 'Do you find it easy to stick to a strict schedule?' },

  // Topic: Technology (5)
  { id: 'p1_tc_1', topic: 'Technology', question: 'What electronic device do you rely on the most each day?' },
  { id: 'p1_tc_2', topic: 'Technology', question: 'How has the internet changed the way you learn new things?' },
  { id: 'p1_tc_3', topic: 'Technology', question: 'Do you think you spend too much time in front of digital screens?' },
  { id: 'p1_tc_4', topic: 'Technology', question: 'What new technological gadget would you like to buy next?' },
  { id: 'p1_tc_5', topic: 'Technology', question: 'Do you prefer sending text messages or calling people directly?' },

  // Topic: Food & Cooking (5)
  { id: 'p1_fc_1', topic: 'Food & Cooking', question: 'What kind of food do you enjoy eating the most?' },
  { id: 'p1_fc_2', topic: 'Food & Cooking', question: 'Do you often cook meals for yourself at home?' },
  { id: 'p1_fc_3', topic: 'Food & Cooking', question: 'Did you learn to cook when you were growing up?' },
  { id: 'p1_fc_4', topic: 'Food & Cooking', question: 'Do you prefer dining out at restaurants or eating at home?' },
  { id: 'p1_fc_5', topic: 'Food & Cooking', question: 'What is a popular traditional dish in your country?' },

  // Topic: Travel & Transport (5)
  { id: 'p1_tr_1', topic: 'Travel & Transport', question: 'How do you usually travel around your city or town?' },
  { id: 'p1_tr_2', topic: 'Travel & Transport', question: 'Do you prefer public transportation or driving a private car?' },
  { id: 'p1_tr_3', topic: 'Travel & Transport', question: 'What is your favorite destination you have ever visited?' },
  { id: 'p1_tr_4', topic: 'Travel & Transport', question: 'Do you enjoy traveling alone, or do you prefer going with friends?' },
  { id: 'p1_tr_5', topic: 'Travel & Transport', question: 'Where would you like to travel for your next holiday?' },

  // Topic: Hobbies & Free Time (5)
  { id: 'p1_hb_1', topic: 'Hobbies', question: 'What activities do you enjoy doing during your free time?' },
  { id: 'p1_hb_2', topic: 'Hobbies', question: 'How much free time do you usually get each week?' },
  { id: 'p1_hb_3', topic: 'Hobbies', question: 'Did you have any different hobbies when you were younger?' },
  { id: 'p1_hb_4', topic: 'Hobbies', question: 'Is there a new hobby or sport you would love to try soon?' },
  { id: 'p1_hb_5', topic: 'Hobbies', question: 'Do you prefer spending your leisure time indoors or outdoors?' },

  // Topic: Music & Art (5)
  { id: 'p1_ma_1', topic: 'Music & Art', question: 'What style of music do you listen to most frequently?' },
  { id: 'p1_ma_2', topic: 'Music & Art', question: 'Can you play any musical instruments, or would you like to learn one?' },
  { id: 'p1_ma_3', topic: 'Music & Art', question: 'Do you enjoy attending live concerts or music festivals?' },
  { id: 'p1_ma_4', topic: 'Music & Art', question: 'Did you enjoy art classes when you were in school?' },
  { id: 'p1_ma_5', topic: 'Music & Art', question: 'How does listening to music influence your mood during the day?' },

  // Topic: Weather & Seasons (5)
  { id: 'p1_wt_1', topic: 'Weather', question: 'What type of weather do you find most pleasant?' },
  { id: 'p1_wt_2', topic: 'Weather', question: 'Does rainy weather have an impact on your mood or daily plans?' },
  { id: 'p1_wt_3', topic: 'Weather', question: 'What is your favorite season of the year, and why?' },
  { id: 'p1_wt_4', topic: 'Weather', question: 'Does the weather change dramatically where you live throughout the year?' },
  { id: 'p1_wt_5', topic: 'Weather', question: 'Do you always check the weather forecast before leaving your home?' },

  // Topic: Friends & Social Life (5)
  { id: 'p1_fr_1', topic: 'Friends', question: 'How often do you usually spend time with your close friends?' },
  { id: 'p1_fr_2', topic: 'Friends', question: 'What activities do you and your friends enjoy doing together?' },
  { id: 'p1_fr_3', topic: 'Friends', question: 'Do you prefer having a large circle of friends or a few close companions?' },
  { id: 'p1_fr_4', topic: 'Friends', question: 'How do you keep in touch with friends who live in other cities?' },
  { id: 'p1_fr_5', topic: 'Friends', question: 'What qualities do you value most in a good friend?' }
];

export const PART_2_CUE_CARDS: IeltsPart2CueCard[] = [
  {
    id: 'p2_cc_1',
    topic: 'Memorable Journey',
    title: 'Describe a memorable journey you took by public transport.',
    prompt: 'You should say:\n- where you went\n- who you traveled with\n- what happened on the journey\n- and explain why this journey was so memorable to you.',
    bullets: ['where you went', 'who you traveled with', 'what happened on the journey', 'why this journey was so memorable to you']
  },
  {
    id: 'p2_cc_2',
    topic: 'Useful Skill',
    title: 'Describe a useful skill you learned as a teenager.',
    prompt: 'You should say:\n- what the skill was\n- who taught you or how you learned it\n- how long it took to learn\n- and explain why this skill has been useful to you.',
    bullets: ['what the skill was', 'how you learned it', 'how long it took to learn', 'why this skill has been useful to you']
  },
  {
    id: 'p2_cc_3',
    topic: 'Inspiring Person',
    title: 'Describe a person you know who has had a strong positive influence on you.',
    prompt: 'You should say:\n- who this person is\n- how you know them\n- what qualities they possess\n- and explain how they have influenced your life.',
    bullets: ['who this person is', 'how you know them', 'what qualities they possess', 'how they have influenced your life']
  },
  {
    id: 'p2_cc_4',
    topic: 'Challenging Decision',
    title: 'Describe an important decision that took you a long time to make.',
    prompt: 'You should say:\n- what the decision was\n- what choices you had to consider\n- who helped or advised you\n- and explain why making this decision was so challenging.',
    bullets: ['what the decision was', 'what choices you considered', 'who helped you', 'why making this decision was challenging']
  },
  {
    id: 'p2_cc_5',
    topic: 'Environmental Project',
    title: 'Describe an environmental activity or project you took part in or heard about.',
    prompt: 'You should say:\n- what the project was\n- where and when it took place\n- what people did in this project\n- and explain how it helped the environment.',
    bullets: ['what the project was', 'where and when it took place', 'what people did', 'how it helped the environment']
  },
  {
    id: 'p2_cc_6',
    topic: 'Technological Device',
    title: 'Describe an electronic device that has made your life much easier.',
    prompt: 'You should say:\n- what the device is\n- when and where you got it\n- what you mainly use it for\n- and explain why it has made your life easier.',
    bullets: ['what the device is', 'how you got it', 'what you use it for', 'why it made your life easier']
  },
  {
    id: 'p2_cc_7',
    topic: 'Historic Building',
    title: 'Describe a historical building or monument you have visited.',
    prompt: 'You should say:\n- where it is located\n- what it looks like\n- what historical events are linked to it\n- and explain how you felt when visiting it.',
    bullets: ['where it is located', 'what it looks like', 'what history is linked to it', 'how you felt when visiting it']
  },
  {
    id: 'p2_cc_8',
    topic: 'Book or Film',
    title: 'Describe a book or film that made a deep impression on you.',
    prompt: 'You should say:\n- what the title was\n- what the story was about\n- when you read or watched it\n- and explain why it made such a deep impression.',
    bullets: ['what the title was', 'what the story was about', 'when you read or watched it', 'why it made a deep impression']
  },
  {
    id: 'p2_cc_9',
    topic: 'Team Success',
    title: 'Describe a time when you worked successfully as part of a team.',
    prompt: 'You should say:\n- what the project or task was\n- who the team members were\n- what your role in the team was\n- and explain why the team was successful.',
    bullets: ['what the task was', 'who the members were', 'what your role was', 'why the team was successful']
  },
  {
    id: 'p2_cc_10',
    topic: 'Public Park',
    title: 'Describe an outdoor park or garden in your city that you enjoy visiting.',
    prompt: 'You should say:\n- where this park is located\n- what facilities or scenery it has\n- how often you go there\n- and explain why you enjoy visiting this park.',
    bullets: ['where the park is', 'what facilities it has', 'how often you go there', 'why you enjoy visiting it']
  },
  {
    id: 'p2_cc_11',
    topic: 'Traditional Festival',
    title: 'Describe a cultural celebration or traditional festival in your country.',
    prompt: 'You should say:\n- what the festival is and when it happens\n- what people wear or eat\n- what traditional activities take place\n- and explain why this festival is important.',
    bullets: ['what the festival is', 'what people wear or eat', 'what activities take place', 'why this festival is important']
  },
  {
    id: 'p2_cc_12',
    topic: 'Healthy Habit',
    title: 'Describe a healthy habit you have developed recently.',
    prompt: 'You should say:\n- what the habit is\n- when and why you started it\n- how difficult it was to maintain at first\n- and explain how it has improved your health.',
    bullets: ['what the habit is', 'when and why you started it', 'how difficult it was at first', 'how it improved your health']
  },
  {
    id: 'p2_cc_13',
    topic: 'Childhood Memory',
    title: 'Describe a happy memory from your childhood.',
    prompt: 'You should say:\n- what happened\n- where you were\n- who was with you\n- and explain why this memory remains so clear and happy to you.',
    bullets: ['what happened', 'where you were', 'who was with you', 'why this memory remains happy to you']
  },
  {
    id: 'p2_cc_14',
    topic: 'Online Course',
    title: 'Describe an interesting online lecture, course, or video you learned from.',
    prompt: 'You should say:\n- what the topic was\n- who presented it\n- what key ideas you learned\n- and explain why you found it particularly interesting.',
    bullets: ['what the topic was', 'who presented it', 'what key ideas you learned', 'why you found it interesting']
  },
  {
    id: 'p2_cc_15',
    topic: 'Gift Received',
    title: 'Describe a thoughtful gift you received that meant a lot to you.',
    prompt: 'You should say:\n- what the gift was\n- who gave it to you and when\n- what the occasion was\n- and explain why this gift was so meaningful to you.',
    bullets: ['what the gift was', 'who gave it to you', 'what the occasion was', 'why it was so meaningful']
  }
];

export const PART_3_QUESTIONS: IeltsPart3Question[] = [
  // Linked to p2_cc_1 (Journey / Transport)
  { id: 'p3_1_1', cueCardId: 'p2_cc_1', topic: 'Transport', question: 'How have public transportation systems improved in modern cities over recent decades?' },
  { id: 'p3_1_2', cueCardId: 'p2_cc_1', topic: 'Transport', question: 'What environmental measures should governments implement regarding private car usage?' },
  { id: 'p3_1_3', cueCardId: 'p2_cc_1', topic: 'Transport', question: 'Do you believe high-speed rail will eventually replace air travel for medium distances?' },

  // Linked to p2_cc_2 (Useful Skill)
  { id: 'p3_2_1', cueCardId: 'p2_cc_2', topic: 'Education', question: 'What practical life skills should be included in secondary school curricula?' },
  { id: 'p3_2_2', cueCardId: 'p2_cc_2', topic: 'Education', question: 'Is it more effective to learn skills through hands-on experience or theoretical study?' },
  { id: 'p3_2_3', cueCardId: 'p2_cc_2', topic: 'Education', question: 'How can older adults be encouraged to acquire digital and technological skills?' },

  // Linked to p2_cc_3 (Inspiring Person)
  { id: 'p3_3_1', cueCardId: 'p2_cc_3', topic: 'Role Models', question: 'What qualities make someone a truly inspiring role model for young people?' },
  { id: 'p3_3_2', cueCardId: 'p2_cc_3', topic: 'Role Models', question: 'Do modern media and social platforms promote the right kind of role models?' },
  { id: 'p3_3_3', cueCardId: 'p2_cc_3', topic: 'Role Models', question: 'To what extent do parents influence children compared to peer groups?' },

  // Linked to p2_cc_4 (Decision Making)
  { id: 'p3_4_1', cueCardId: 'p2_cc_4', topic: 'Decisions', question: 'Why do many people find it difficult to make career decisions early in life?' },
  { id: 'p3_4_2', cueCardId: 'p2_cc_4', topic: 'Decisions', question: 'Should important family decisions always be made democratically?' },
  { id: 'p3_4_3', cueCardId: 'p2_cc_4', topic: 'Decisions', question: 'How has the abundance of information online affected our decision-making ability?' },

  // Linked to p2_cc_5 (Environmental Protection)
  { id: 'p3_5_1', cueCardId: 'p2_cc_5', topic: 'Environment', question: 'Who holds greater responsibility for combating climate change: governments or individuals?' },
  { id: 'p3_5_2', cueCardId: 'p2_cc_5', topic: 'Environment', question: 'Can international climate summits produce realistic solutions to global warming?' },
  { id: 'p3_5_3', cueCardId: 'p2_cc_5', topic: 'Environment', question: 'How can consumers be motivated to adopt zero-waste and recycling habits?' },

  // Linked to p2_cc_6 (Technology)
  { id: 'p3_6_1', cueCardId: 'p2_cc_6', topic: 'Technology', question: 'Will artificial intelligence create more jobs than it displaces in the coming years?' },
  { id: 'p3_6_2', cueCardId: 'p2_cc_6', topic: 'Technology', question: 'How has constant connectivity affected interpersonal relationships and face-to-face communication?' },
  { id: 'p3_6_3', cueCardId: 'p2_cc_6', topic: 'Technology', question: 'Should governments regulate screen time and algorithmic recommendations for minors?' },

  // Linked to p2_cc_7 (Heritage & History)
  { id: 'p3_7_1', cueCardId: 'p2_cc_7', topic: 'Heritage', question: 'Why is it essential for nations to invest in preserving ancient architecture and historical landmarks?' },
  { id: 'p3_7_2', cueCardId: 'p2_cc_7', topic: 'Heritage', question: 'How can museums make historical education more engaging for the younger generation?' },
  { id: 'p3_7_3', cueCardId: 'p2_cc_7', topic: 'Heritage', question: 'Does mass international tourism pose a threat to delicate historic monuments?' },

  // Linked to p2_cc_8 (Books & Media)
  { id: 'p3_8_1', cueCardId: 'p2_cc_8', topic: 'Literature', question: 'Do film adaptations generally do justice to the original literary novels?' },
  { id: 'p3_8_2', cueCardId: 'p2_cc_8', topic: 'Literature', question: 'Will digital audiobooks and e-readers eventually make printed books obsolete?' },
  { id: 'p3_8_3', cueCardId: 'p2_cc_8', topic: 'Literature', question: 'How does reading literature foster empathy and cultural understanding?' },

  // Linked to p2_cc_9 (Teamwork)
  { id: 'p3_9_1', cueCardId: 'p2_cc_9', topic: 'Teamwork', question: 'What are the main challenges when working in culturally diverse international teams?' },
  { id: 'p3_9_2', cueCardId: 'p2_cc_9', topic: 'Teamwork', question: 'How should managers handle disagreements and conflicting personalities within a project team?' },
  { id: 'p3_9_3', cueCardId: 'p2_cc_9', topic: 'Teamwork', question: 'Does remote working enhance team productivity or harm team cohesion?' },

  // Linked to p2_cc_10 (Urban Spaces)
  { id: 'p3_10_1', cueCardId: 'p2_cc_10', topic: 'Urban Planning', question: 'Why are green parks and open public spaces crucial for urban resident wellbeing?' },
  { id: 'p3_10_2', cueCardId: 'p2_cc_10', topic: 'Urban Planning', question: 'How should city planners balance the need for new housing with the preservation of nature?' },
  { id: 'p3_10_3', cueCardId: 'p2_cc_10', topic: 'Urban Planning', question: 'What can communities do to restore neglected public areas in their neighborhoods?' },

  // Linked to p2_cc_11 (Traditions)
  { id: 'p3_11_1', cueCardId: 'p2_cc_11', topic: 'Culture', question: 'Is globalization causing traditional local customs and ceremonies to disappear?' },
  { id: 'p3_11_2', cueCardId: 'p2_cc_11', topic: 'Culture', question: 'How can communities keep traditional festivals authentic rather than overly commercialized?' },
  { id: 'p3_11_3', cueCardId: 'p2_cc_11', topic: 'Culture', question: 'Why do people feel a strong need to celebrate cultural milestones collectively?' },

  // Linked to p2_cc_12 (Health)
  { id: 'p3_12_1', cueCardId: 'p2_cc_12', topic: 'Health', question: 'What role should public health campaigns play in encouraging physical exercise?' },
  { id: 'p3_12_2', cueCardId: 'p2_cc_12', topic: 'Health', question: 'Why is modern sedentary lifestyle a growing health challenge for workplace employees?' },
  { id: 'p3_12_3', cueCardId: 'p2_cc_12', topic: 'Health', question: 'Should governments impose special taxes on unhealthy sugary beverages and junk foods?' },

  // Linked to p2_cc_13 (Childhood)
  { id: 'p3_13_1', cueCardId: 'p2_cc_13', topic: 'Childhood', question: 'How has childhood play changed with the advent of video games and tablet computers?' },
  { id: 'p3_13_2', cueCardId: 'p2_cc_13', topic: 'Childhood', question: 'Is it better for children to grow up in rural villages or bustling urban environments?' },
  { id: 'p3_13_3', cueCardId: 'p2_cc_13', topic: 'Childhood', question: 'What can schools do to reduce academic stress and pressure on young students?' },

  // Linked to p2_cc_14 (Lifelong Learning)
  { id: 'p3_14_1', cueCardId: 'p2_cc_14', topic: 'Online Education', question: 'Can online distance learning provide the same educational value as on-campus university degrees?' },
  { id: 'p3_14_2', cueCardId: 'p2_cc_14', topic: 'Online Education', question: 'What self-discipline strategies are essential for students enrolled in self-paced courses?' },
  { id: 'p3_14_3', cueCardId: 'p2_cc_14', topic: 'Online Education', question: 'How will virtual reality classrooms transform vocational and technical training?' },

  // Linked to p2_cc_15 (Consumerism & Gifts)
  { id: 'p3_15_1', cueCardId: 'p2_cc_15', topic: 'Society', question: 'Has gift-giving become too focused on monetary value rather than sentimental thought?' },
  { id: 'p3_15_2', cueCardId: 'p2_cc_15', topic: 'Society', question: 'Do commercial advertising campaigns manipulate people into buying unnecessary items during holidays?' },
  { id: 'p3_15_3', cueCardId: 'p2_cc_15', topic: 'Society', question: 'How can societies encourage experiences and shared memories over physical possessions?' }
];

import {
  selectUnseenCueCard,
  selectUnseenPart1Questions,
  selectUnseenPart3Questions
} from './legacyIeltsQuestionTracker';

export function getPart1Topics(): string[] {
  return Array.from(new Set(PART_1_QUESTIONS.map((q) => q.topic)));
}

export function generateIeltsSessionPlan(options?: {
  part2CueCardId?: string;
  seed?: number;
  preferUnseen?: boolean;
}): IeltsTestSessionPlan {
  if (options?.preferUnseen !== false) {
    const p1 = selectUnseenPart1Questions({ seed: options?.seed });
    const cueCard = selectUnseenCueCard({
      preferCueCardId: options?.part2CueCardId,
      seed: options?.seed
    });
    const part3Questions = selectUnseenPart3Questions(cueCard.id);

    return {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      part1Topics: p1.topics,
      part1Questions: p1.questions,
      part2CueCard: cueCard,
      part3Questions
    };
  }

  // Deterministic fallback if preferUnseen is explicitly false
  const topics = getPart1Topics();
  const seed = options?.seed ?? Date.now();
  const topicIdx1 = Math.abs(seed) % topics.length;
  const topicIdx2 = (topicIdx1 + 3) % topics.length;

  const t1 = topics[topicIdx1];
  const t2 = topics[topicIdx2];

  const qTopic1 = PART_1_QUESTIONS.filter((q) => q.topic === t1).slice(0, 4);
  const qTopic2 = PART_1_QUESTIONS.filter((q) => q.topic === t2).slice(0, 4);
  const part1Questions = [...qTopic1, ...qTopic2];

  const cueCard =
    (options?.part2CueCardId && PART_2_CUE_CARDS.find((c) => c.id === options.part2CueCardId)) ||
    PART_2_CUE_CARDS[Math.abs(seed >> 2) % PART_2_CUE_CARDS.length];

  const part3Questions = PART_3_QUESTIONS.filter((q) => q.cueCardId === cueCard.id);

  return {
    id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    part1Topics: [t1, t2],
    part1Questions,
    part2CueCard: cueCard,
    part3Questions: part3Questions.length > 0 ? part3Questions : PART_3_QUESTIONS.slice(0, 4)
  };
}
