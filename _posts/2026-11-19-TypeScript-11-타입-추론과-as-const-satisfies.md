---
layout: post
title: "TypeScript (11) - 타입 추론과 as const satisfies"
date: 2026-11-19 13:45:25 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "타입 추론과 as const satisfies"]
---

## 개요

TypeScript는 값이 어떻게 선언되고 사용되는지 살펴 타입을 추론한다. 상황에 따라 구체적인 리터럴을 유지하거나 더 넓은 타입으로 추론하므로 그 차이를 알아 두면 좋다.

## 타입이 넓어지는 이유

값을 변경할 수 있는 변수는 다른 문자열도 담을 수 있도록 추론된다.

```ts
let status = "ready"; // string
status = "done";

const initialStatus = "ready"; // "ready"
```

`let` 변수는 재할당할 수 있어 `string`으로 추론된다. `const` 변수는 재할당할 수 없어 이 예에서는 리터럴 타입 `"ready"`가 유지된다.

객체를 `const`로 선언해도 속성은 변경할 수 있다.

```ts
const task = { status: "ready" }; // status: string
task.status = "done";
```

## as const로 리터럴 유지하기

`as const`를 사용하면 리터럴을 넓히지 않고 객체 속성과 배열 요소를 읽기 전용으로 추론한다.

```ts
const task = { status: "ready", tags: ["work", "urgent"] } as const;
// task.status: "ready"
// task.tags: readonly ["work", "urgent"]
```

이 예에서 `task.status`를 다른 값으로 바꾸거나 `task.tags.push(...)`를 호출하면 타입 오류가 난다. `as const`는 타입 검사에 영향을 주며 런타임에 객체를 동결하지는 않는다.

## satisfies로 형태 확인하기

`satisfies`는 값이 지정한 타입에 맞는지 검사하면서 표현식의 유용한 구체적 타입 정보를 유지한다.

```ts
type Page = "home" | "about";
type PageInfo = { title: string };

const pages = {
    home: { title: "홈" },
    about: { title: "소개" },
} satisfies Record<Page, PageInfo>;

console.log(pages.home.title); // 홈
```

필수 페이지가 빠지거나 `title`에 숫자를 넣으면 오류가 난다. `satisfies` 자체가 모든 값을 리터럴 타입으로 고정하지는 않는다. 리터럴도 유지하려면 필요에 따라 `as const`와 함께 사용할 수 있다.

```ts
const pages = {
    home: { title: "홈" },
    about: { title: "소개" },
} as const satisfies Record<Page, PageInfo>;
// pages.home.title: "홈"
```

## 정리

TypeScript의 추론은 값의 변경 가능성에 영향을 받는다. `as const`는 리터럴과 읽기 전용 타입을 유지하고, `satisfies`는 타입에 맞는지 검사하면서 표현식의 구체적인 타입 정보를 활용할 수 있게 한다.
