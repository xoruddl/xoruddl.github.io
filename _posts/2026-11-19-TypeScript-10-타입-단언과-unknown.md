---
layout: post
title: "TypeScript (10) - 타입 단언과 unknown"
date: 2026-11-19 13:45:25 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "타입 단언과 unknown"]
---

## 개요

외부에서 받은 값은 어떤 형태인지 확실하지 않을 수 있다. 이때 타입을 지정하는 방법과 실제 값을 검사하는 방법의 차이를 이해해야 한다.

## any와 unknown

`any`와 `unknown`은 모두 다양한 값을 담을 수 있다. 차이는 값을 사용할 때 나타난다.

```ts
let unsafe: any = "hello";
unsafe.missing(); // 타입 검사 통과, 실행하면 오류

let uncertain: unknown = "hello";
// uncertain.toUpperCase(); // 오류: 타입을 먼저 확인해야 한다
if (typeof uncertain === "string") {
    console.log(uncertain.toUpperCase()); // HELLO
}
```

`any`는 해당 값에 대한 타입 검사를 대부분 생략한다. `unknown`은 값을 사용하기 전에 타입을 확인하도록 요구한다. 형태를 모르는 데이터에는 `unknown`이 더 안전한 출발점이다.

## 타입 단언 as

타입 단언은 개발자가 값의 타입에 관해 TypeScript에 알려 주는 문법이다.

```ts
const input = document.querySelector("#username") as HTMLInputElement | null;
if (input !== null) {
    console.log(input.value);
}
```

이 코드는 선택한 요소가 존재한다면 입력 요소라고 가정한다. `as`는 값을 변환하거나 실제 요소의 종류를 확인하지 않는다. 잘못된 가정은 실행 중 오류로 이어질 수 있다. 확실하지 않을 때는 실제 값을 검사해야 한다.

## API 응답 확인하기

다음은 응답을 `unknown`으로 받아 검사하는 예다.

```ts
interface User {
    name: string;
}

function isUser(value: unknown): value is User {
    return typeof value === "object" && value !== null
        && "name" in value && typeof value.name === "string";
}

async function loadUser(): Promise<User> {
    const response = await fetch("/api/user");
    if (!response.ok) throw new Error("사용자 요청 실패");
    const data: unknown = await response.json();
    if (!isUser(data)) throw new Error("잘못된 사용자 데이터");
    return data;
}
```

`isUser`가 실제 `name` 값을 확인한 뒤에만 `User`로 사용할 수 있다. JSON 파싱 실패나 네트워크 오류도 호출하는 쪽에서 처리해야 한다.

## 정리

`any`는 검사를 우회하고, `unknown`은 확인하기 전의 값을 안전하게 다룰 수 있게 한다. 타입 단언 `as`는 컴파일러에 전달하는 개발자의 가정이며 런타임 검증은 수행하지 않는다.
