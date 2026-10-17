/**
 * **LiDAR 분류기** (ai/perception.ts · models/lidar.json · scripts/train-lidar.ts).
 *
 * 배포한 신경망이 지금의 특징과 맞는지(특징을 바꾸고 다시 학습하지 않으면 여기서 걸린다), 그리고 학습에도 시험에도 쓰지 않은
 * 새 장면에서 손 규칙보다 정확한지를 본다. 장면은 학습 데이터와 같은 생성기(ai/lidarScenes.ts)로, 다른 씨앗으로 짓는다.
 */

import { describe, expect, it } from 'vitest';

import { labeledClusters, type LabeledCluster } from '../src/ai/lidarScenes';
import { CLASSES, LIDAR_FEATURES, classProbs, type LidarModel } from '../src/ai/perception';
import trained from '../src/ai/models/lidar.json';

const model = trained as unknown as LidarModel;
const rows = labeledClusters(300, 31337);
const learned = (r: LabeledCluster): string => {
  const p = classProbs(r.x, model);
  return CLASSES[p.indexOf(Math.max(...p))];
};
const accuracy = (xs: LabeledCluster[], pick: (r: LabeledCluster) => string): number =>
  xs.filter((r) => pick(r) === r.label).length / xs.length;

describe('LiDAR 분류기', () => {
  it('학습한 모델이다 — 특징 이름 · 차례가 지금의 특징과 같다 (바꿨으면 npm run train:lidar)', () => {
    expect(model.meta.trained).toBe(true);
    expect(model.kind).toBe('mlp');
    expect(model.names).toEqual([...LIDAR_FEATURES]);
    expect(model.classes).toEqual([...CLASSES]);
  });

  /*
    차 조각을 합치게 되면서(perception.ts 의 mergeLowClusters) 손 규칙도 80% → 88% 로 올랐다 — 조각난 차를 '알 수 없음' 으로
    버리던 것이 줄어서다. 그래도 신경망이 앞선다(전체 5%p 넘게, 자전거는 아래 검사).
  */
  it('새 장면에서 손 규칙보다 5%p 넘게 정확하다', () => {
    const a = accuracy(rows, learned);
    const rule = accuracy(rows, (r) => r.rule);
    expect(rows.length).toBeGreaterThan(1000);
    expect(a).toBeGreaterThan(0.94);
    expect(a - rule).toBeGreaterThan(0.05);
  });

  it('갈래마다 놓치는 것이 적다 — 자전거도 열에 아홉 가까이', () => {
    const recall = (c: string) => accuracy(rows.filter((r) => r.label === c), learned);
    expect(recall('adult')).toBeGreaterThan(0.93);
    expect(recall('child')).toBeGreaterThan(0.93);
    expect(recall('bike')).toBeGreaterThan(0.85);
    expect(recall('car')).toBeGreaterThan(0.97);
  });

  it('빗길 · 차 뒤에 가린 물체에서도 규칙보다 낫다', () => {
    for (const f of [(r: LabeledCluster) => r.rain, (r: LabeledCluster) => r.occluded]) {
      const xs = rows.filter(f);
      expect(accuracy(xs, learned)).toBeGreaterThan(accuracy(xs, (r) => r.rule));
    }
  });

  it('학습 정보가 남아 있다 — 신경망 > 로지스틱 > 규칙 (장표가 읽는 값)', () => {
    const { accuracy: nn, softmaxAccuracy: lr, ruleAccuracy: rule } = model.meta as Record<string, number>;
    expect(nn).toBeGreaterThan(lr);
    expect(lr).toBeGreaterThan(rule);
  });
});
