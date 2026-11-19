---
layout: post
title: "TypeScript (8) - 타입 좁히기와 타입 가드"
date: 2026-11-19 13:45:25 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "타입 좁히기와 타입 가드"]
---

## 개요

유니온 타입은 하나의 값이 여러 타입 중 하나일 수 있음을 나타낸다. 하지만 어떤 타입인지 확인하기 전에는 모든 후보에 공통으로 있는 기능만 안전하게 사용할 수 있다.

조건문으로 값의 타입을 확인해 가능한 범위를 줄이는 과정을 **타입 좁히기**(narrowing)라고 한다. 이때 사용하는 검사를 **타입 가드**라고 부른다.

## typeof로 기본 타입 확인하기

문자열과 숫자를 구분해 각각 다르게 처리해 보자.

```ts
function format(value: string | number): string {
    if (typeof value === "string") {
        return value.toUpperCase();
    }
    return value.toFixed(2);
}

console.log(format("hello")); // HELLO
console.log(format(3.5)); // 3.50
```

조건이 참인 곳에서는 `value`가 `string`이고, 나머지 분기에서는 `number`다. TypeScript가 조건과 실행 흐름을 따라가며 타입을 좁힌다.

## in으로 속성 확인하기

객체의 속성 존재 여부도 타입을 구분하는 기준이 된다.

```ts
type Cat = { meow: () => void };
type Dog = { bark: () => void };

function makeSound(animal: Cat | Dog): void {
    if ("meow" in animal) {
        animal.meow();
    } else {
        animal.bark();
    }
}
```

`meow`가 있는 분기에서는 `Cat`, 나머지는 `Dog`로 좁혀진다. 단, 선택 속성은 양쪽 분기에 남을 수 있으므로 속성 하나로 항상 타입이 확정되는 것은 아니다.

## instanceof로 인스턴스 확인하기

클래스로 만든 객체는 `instanceof`로 구분할 수 있다.

```ts
function describe(value: Date | string): string {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
}
```

참인 분기에서 `value`는 `Date`이므로 날짜 메서드를 호출할 수 있다. `instanceof`는 실행 시 존재하는 생성자를 사용하므로 interface에는 적용할 수 없다.

## 사용자 정의 타입 가드

반복해서 사용할 검사는 함수로 분리할 수 있다. 다음 함수는 값이 문자열인지 검사한다.

```ts
function isString(value: unknown): value is string {
    return typeof value === "string";
}

const value: unknown = "hello";
if (isString(value)) {
    console.log(value.toUpperCase()); // HELLO
}
```

반환 타입 `value is string`은 함수가 참을 반환할 때 `value`를 `string`으로 취급하라는 **타입 서술어**다. TypeScript는 함수 본문이 서술어를 정확히 구현했는지 보장하지 않으므로 검사를 올바르게 작성해야 한다.

## never로 빠진 경우 확인하기

4편에서 살펴본 식별 가능한 유니온에 새 상태가 추가될 때 처리를 놓치지 않도록 해 보자.

```ts
type Result =
    | { status: "success"; data: string }
    | { status: "error"; message: string };

function assertNever(value: never): never {
    throw new Error(`처리하지 않은 상태: ${JSON.stringify(value)}`);
}

function describeResult(result: Result): string {
    switch (result.status) {
        case "success": return result.data;
        case "error": return result.message;
        default: return assertNever(result);
    }
}
```

모든 상태를 처리하면 `default`의 `result`는 가능한 값이 없는 `never`다. `Result`에 새 상태를 추가하고 분기를 작성하지 않으면 `assertNever`에 전달하는 부분에서 오류가 난다.

## 정리

`typeof`, `in`, `instanceof`는 조건에 따라 가능한 타입을 좁혀 준다. 반복되는 검사는 사용자 정의 타입 가드로 분리할 수 있다.

식별 가능한 유니온을 `switch`로 처리할 때는 `never`를 이용해 빠진 경우가 없는지 확인할 수 있다.
