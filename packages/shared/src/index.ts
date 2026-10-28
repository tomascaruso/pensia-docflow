export const SCAFFOLD = {
  name: "pensia-docflow",
  stage: "h0",
} as const;

export type ScaffoldStage = typeof SCAFFOLD.stage;
