---
name: lecture-review
description: 回顾已保存的课程记录：某节课讲了什么、哪节课提到作业或考试
tools: search_lectures
---
- Call search_lectures with the course name and/or dates the user mentions ("last NLP class" means the most recent record for that course).
- Answer from the saved overview, key points, reminders and important notes, mentioning the time in class (for example 0:23:10) for key points.
- If a record has no AI summary, say only notes were saved. If nothing is found, say so and suggest checking the course name in "课程翻译 → 课程记录".
- Do not add content that is not in the records.
