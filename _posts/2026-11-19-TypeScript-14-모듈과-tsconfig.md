---
layout: post
title: "TypeScript (14) - 모듈과 tsconfig"
date: 2026-11-19 13:45:25 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "모듈과 tsconfig"]
---

## 개요

파일이 늘어나면 타입과 함수를 모듈로 나누어 관리한다. TypeScript는 컴파일할 파일과 검사 방식을 `tsconfig.json`으로 설정한다.

## 모듈에서 내보내고 가져오기

사용자 타입과 함수를 파일 밖에서 쓸 수 있도록 내보낸다.

```ts
// user.ts
export interface User {
    name: string;
}

export function greet(user: User): string {
    return `안녕하세요, ${user.name}님`;
}
```

다른 파일에서는 필요한 항목을 가져온다.

```ts
// main.ts
import { greet } from "./user";
import type { User } from "./user";

const user: User = { name: "민지" };
console.log(greet(user));
```

`import type`은 타입을 가져온다는 뜻이며 JavaScript 출력에서 제거된다. 타입을 다시 내보낼 때는 `export type { User } from "./user"`처럼 쓸 수 있다. 실제 import 경로와 확장자 규칙은 실행 환경과 모듈 설정에 따라 달라진다.

## tsconfig.json 만들기

다음은 브라우저용 번들러를 사용하는 프로젝트의 출발점 예시다.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`strict`는 엄격한 타입 검사 옵션들을 켠다. `target`은 JavaScript 출력 대상 버전을, `module`은 모듈 방식을 지정한다. `moduleResolution`은 import 경로를 찾는 방식을 정하고, `noEmit`은 TypeScript가 파일을 출력하지 않고 검사만 하게 한다. 이 예에서는 별도의 번들러가 실행할 코드를 만든다.

설정 파일이 있는 프로젝트에서 다음 명령으로 타입 검사를 실행한다.

```bash
npx tsc --noEmit
```

`src` 아래 파일에 타입 오류가 있으면 터미널에 위치와 내용이 표시된다. Node.js에서 직접 실행하는 프로젝트는 Node의 모듈 방식에 맞는 설정이 필요하므로 위 설정을 그대로 복사하기보다 환경에 맞춰 선택해야 한다.

## 정리

모듈은 파일 간에 값과 타입을 공유하는 방법이다. `import type`과 `export type`은 타입만 주고받는 의도를 드러낸다.

`tsconfig.json`은 검사와 출력 방식을 정한다. 특히 모듈 설정은 실제 실행 환경과 함께 선택해야 한다.
