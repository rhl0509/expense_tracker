import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Next 16 의 react-hooks/set-state-in-effect 는 브라우저 값 초기화(localStorage·테마),
    // 입력 변경 시 파생 상태 리셋, 비동기 데이터 로드 후 기본값 채움 같은 정당한 useEffect
    // 패턴까지 잡는다. 이 앱은 그런 패턴을 의도적으로 쓰고, 렌더 중 계산으로 강제로 바꾸면
    // SSR 하이드레이션·리셋 타이밍이 깨질 수 있어 이 규칙을 끈다(next build 는 원래 이
    // 규칙으로 실패하지 않는다).
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
