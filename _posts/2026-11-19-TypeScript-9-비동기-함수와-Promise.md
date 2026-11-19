---
layout: post
title: "TypeScript (9) - 비동기 함수와 Promise"
date: 2026-11-19 13:45:25 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "비동기 함수와 Promise"]
---

## 개요

서버에 데이터를 요청하거나 파일을 읽는 작업은 결과가 바로 나오지 않는다. JavaScript는 이런 작업을 기다리는 동안 다른 코드를 계속 실행하고, 결과 대신 "끝나면 값을 주겠다"는 약속 객체를 먼저 돌려준다. 이 객체가 **Promise**다.

TypeScript에서는 Promise가 나중에 어떤 값을 줄지 타입으로 표시할 수 있다. 이 글에서는 `Promise<T>`, `async`, `await`를 타입 관점에서 살펴본다.

## Promise\<T\>: 나중에 T를 주는 약속

카페에서 주문하면 커피 대신 진동벨을 먼저 받는다. Promise는 이 진동벨과 같다. 작업이 성공하면 값을 받고(fulfilled), 실패하면 오류를 받는다(rejected).

1초 뒤에 사용자 이름을 돌려주는 함수를 만들어 보자.

```ts
function getUserName(): Promise<string> {
    return new Promise((resolve) => {
        setTimeout(() => resolve("Kim"), 1000);
    });
}

const result = getUserName();
console.log(result); // Promise { <pending> }
```

`resolve`는 약속한 값을 전달하는 함수다. 반환 타입 `Promise<string>`은 "나중에 문자열을 주는 약속"이라는 뜻이다. 6편에서 본 제네릭처럼 `<>` 안에 약속이 지켜졌을 때 받을 값의 타입을 적는다.

`getUserName()`을 호출한 직후의 `result`는 문자열이 아니라 아직 끝나지 않은 Promise다.

| 타입 | 뜻 |
| --- | --- |
| `Promise<string>` | 나중에 문자열을 준다 |
| `Promise<User>` | 나중에 `User`를 준다 |
| `Promise<void>` | 끝났다는 사실만 알리고 값은 없다 |

## await: 약속이 끝날 때까지 기다리기

`await`는 Promise가 끝날 때까지 기다렸다가 그 안의 값을 꺼낸다.

```ts
async function printUserName(): Promise<void> {
    const name = await getUserName(); // name: string
    console.log(name.toUpperCase()); // KIM
}
```

`getUserName()`의 타입은 `Promise<string>`이지만, `await`를 붙이면 `string`이 된다. 즉 `await`는 `Promise<T>`에서 `T`를 꺼낸다.

`await`를 빠뜨리면 TypeScript가 바로 알려 준다.

```ts
async function printUserName(): Promise<void> {
    const name = getUserName(); // name: Promise<string>
    // name.toUpperCase(); // 오류: Promise<string>에는 toUpperCase가 없다
}
```

진동벨을 커피처럼 마시려는 것과 같다. 이처럼 Promise를 값으로 착각하는 실수를 타입 검사 단계에서 잡을 수 있다.

## async 함수의 반환 타입

`await`는 `async`가 붙은 함수 안에서 사용한다. `async` 함수는 반환값을 자동으로 Promise로 감싼다.

```ts
async function getGreeting(): Promise<string> {
    const name = await getUserName();
    return `안녕하세요, ${name}님`; // string을 반환
}
```

함수 안에서는 문자열을 반환하지만, 반환 타입은 `Promise<string>`이다. 이 함수도 끝나기까지 시간이 걸리므로 호출한 쪽에 약속을 돌려주기 때문이다. 반환 타입을 `string`으로 적으면 오류가 난다.

```ts
// async function getGreeting(): string { ... }
// 오류: async 함수의 반환 타입은 Promise<T>여야 한다
```

호출하는 쪽도 결과를 쓰려면 다시 `await`로 꺼내야 한다.

```ts
async function main(): Promise<void> {
    const greeting = await getGreeting(); // greeting: string
    console.log(greeting); // 안녕하세요, Kim님
}

main();
```

## try/catch로 실패 처리하기

Promise가 실패하면 `await`한 자리에서 오류가 던져진다. 이 오류는 `try/catch`로 받는다.

```ts
async function getUserNameOrFail(): Promise<string> {
    throw new Error("사용자를 찾을 수 없음");
}

async function main(): Promise<void> {
    try {
        const name = await getUserNameOrFail();
        console.log(name);
    } catch (error) {
        // error: unknown
        if (error instanceof Error) {
            console.log(error.message); // 사용자를 찾을 수 없음
        }
    }
}
```

`catch`로 받은 `error`의 타입은 `unknown`이다. `unknown`은 "어떤 값인지 아직 모른다"는 타입으로, 확인하기 전에는 속성을 사용할 수 없다. JavaScript에서는 `Error` 객체뿐 아니라 문자열이나 숫자도 던질 수 있기 때문이다. 그래서 8편에서 본 `instanceof`로 `Error`인지 확인한 뒤 `message`를 사용한다.

`strict` 옵션을 켜면 `catch`의 변수가 `unknown`이 된다. 이 옵션이 꺼진 오래된 설정에서는 `any`로 취급된다. 

## Awaited\<T\>: Promise 안의 타입 꺼내기

`await`가 값에서 Promise를 벗겨 내듯, 타입에서 Promise를 벗겨 내는 유틸리티 타입도 있다.

```ts
type A = Awaited<Promise<string>>; // string
type B = Awaited<Promise<Promise<number>>>; // number
type C = Awaited<boolean>; // boolean
```

`Awaited<T>`는 `T`를 `await`했을 때 얻는 타입을 계산한다. Promise가 겹쳐 있으면 끝까지 벗기고, Promise가 아니면 그대로 둔다. 직접 쓸 일이 많지는 않지만, 비동기 함수의 결과 타입을 다른 타입에서 재사용할 때 쓴다.

## 정리

`Promise<T>`는 나중에 `T` 타입의 값을 주겠다는 약속이다. `await`는 Promise가 끝날 때까지 기다렸다가 `T`를 꺼내고, `async` 함수는 반환값을 자동으로 `Promise<T>`로 감싼다. 그래서 `async` 함수의 반환 타입은 항상 `Promise<T>`로 적는다.

실패한 Promise는 `await`한 자리에서 오류를 던지므로 `try/catch`로 처리한다. `catch`의 `error`는 `unknown`이므로 `instanceof` 같은 타입 가드로 확인한 뒤 사용한다.
