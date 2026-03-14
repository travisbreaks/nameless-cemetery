import { defineCollection, z } from 'astro:content'

const stories = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.date(),
    author: z.string(),
    category: z.string().default('Community'),
    description: z.string().optional(),
    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string(),
          caption: z.string().optional(),
        })
      )
      .optional(),
    comments: z
      .array(
        z.object({
          name: z.string(),
          date: z.string(),
          text: z.string(),
          isReply: z.boolean().default(false),
        })
      )
      .optional(),
    originalUrl: z.string().optional(),
  }),
})

export const collections = { stories }
