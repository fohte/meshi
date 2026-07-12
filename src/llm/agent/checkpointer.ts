import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

// Dedicated schema so LangGraph's own checkpoint migrations (tracked via
// its own checkpoint_migrations table) never collide with this app's
// drizzle-managed public schema.
export const MESHI_CHECKPOINT_SCHEMA = 'langgraph'

export const createMeshiCheckpointer = (databaseUrl: string): PostgresSaver =>
  PostgresSaver.fromConnString(databaseUrl, { schema: MESHI_CHECKPOINT_SCHEMA })

// Must be called once, at migration time (see src/db/migrate.ts and
// src/test/global-setup.ts), never from the running server: setup() creates
// tables if missing and is not safe to race across multiple replicas
// starting concurrently.
export const setupMeshiCheckpointSchema = async (
  databaseUrl: string,
): Promise<void> => {
  const checkpointer = createMeshiCheckpointer(databaseUrl)
  try {
    await checkpointer.setup()
  } finally {
    await checkpointer.end()
  }
}
