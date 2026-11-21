import type { Pool } from '@vichaar/db';

export interface MilestoneRepository {
  list(
    publicationId: string,
  ): Promise<{
    milestones: Array<{ kind: string; threshold: number; createdAt: string }>;
    streak: { currentWeeks: number; longestWeeks: number; lastPostWeek: string | null };
  }>;
}
export function createMilestoneRepository(pool: Pool): MilestoneRepository {
  return {
    async list(publicationId) {
      const [achievements, streak] = await Promise.all([
        pool.query<{ kind: string; threshold: number; created_at: Date }>(
          'SELECT kind,threshold,created_at FROM milestones WHERE publication_id=$1 ORDER BY threshold',
          [publicationId],
        ),
        pool.query<{ current_weeks: number; longest_weeks: number; last_post_week: string | null }>(
          "SELECT current_weeks,longest_weeks,to_char(last_post_week,'YYYY-MM-DD') AS last_post_week FROM writing_streaks WHERE publication_id=$1",
          [publicationId],
        ),
      ]);
      return {
        milestones: achievements.rows.map((row) => ({
          kind: row.kind,
          threshold: row.threshold,
          createdAt: row.created_at.toISOString(),
        })),
        streak: {
          currentWeeks: streak.rows[0]?.current_weeks ?? 0,
          longestWeeks: streak.rows[0]?.longest_weeks ?? 0,
          lastPostWeek: streak.rows[0]?.last_post_week ?? null,
        },
      };
    },
  };
}
