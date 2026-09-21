/**
 * 판정 엔진 테스트용 주행 시뮬레이터.
 *
 * **구현은 src/scenarios/driveSim.ts 에 있다.** 시나리오 검증기(validate.ts)가 같은
 * 시뮬레이터로 AI 가 만든 판을 돌려 보기 때문에, 테스트에서만 쓰는 도구로 둘 수 없었다.
 *
 * 이 파일은 기존 테스트가 부르던 이름을 그대로 유지하기 위한 재export 다 —
 * 옮기면서 테스트 스무 개의 import 를 건드릴 이유는 없다.
 */

export {
  alwaysWaiting,
  crossingBetween,
  simulate,
  type DriverConfig,
  type TurnStyle,
  type WorldConfig,
} from '../src/scenarios/driveSim';
