---
layout: post
title: "TypeScript (1) - 기본 타입"
date: 2026-11-19 00:20:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "기본 타입", "tuple", "enum"]
---

## 타입 지정과 타입 추론

변수 이름 뒤에 `: 타입`을 붙이면 그 변수에 담을 수 있는 값의 타입이 정해진다. `car`는 `string`으로 선언했으므로 다른 문자열은 다시 넣을 수 있지만, 숫자 같은 다른 타입을 넣으면 컴파일 에러가 난다.

```ts
let car: string = 'bmw';

car = 'benz'
```

타입을 직접 적지 않아도 TypeScript는 처음 대입한 값을 보고 타입을 정한다. 이를 **타입 추론**이라고 한다. `let car = 'bmw';`라고만 써도 `car`는 `string` 타입이 된다.

## 기본 타입과 배열

숫자는 `number`, 참/거짓은 `boolean`으로 지정한다. 배열은 `타입[]` 또는 `Array<타입>` 두 가지 방식으로 쓸 수 있고, 둘은 같은 의미다.

```ts
let age: number = 30;
let isAdult: boolean = true;
let a: number[] = [1, 2, 3];
let a2: Array<number> = [1, 2, 3];

let week1: string[] = ['mon', 'tue', 'wed'];
let week2: Array<string> = ['mon', 'tue', 'wed'];

week1.push('thu')

console.log(week1);
// [ 'mon', 'tue', 'wed', 'thu' ]
```

`week1`은 `string[]`이므로 문자열은 `push`할 수 있지만, `week1.push(3)`처럼 숫자를 넣으면 에러가 난다.

## 튜플 (tuple)

튜플은 길이와 각 위치의 타입이 정해진 배열이다. `b`의 첫 번째 요소는 `string`, 두 번째 요소는 `number`여야 한다.

```ts
// tuple

let b: [string, number];

b = ['z', 1];
b[0].toLowerCase();
```

`b[0]`이 `string`이라는 것을 알고 있으므로 `toLowerCase()` 같은 문자열 메서드를 쓸 수 있다. 반대로 `b = [1, 'z']`처럼 순서를 바꾸면 에러가 난다.

## void와 never

`void`는 함수가 아무 값도 반환하지 않을 때 쓴다. `never`는 함수가 끝까지 실행을 마치지 못하는 경우, 즉 항상 에러를 던지거나 무한 루프를 도는 함수의 반환 타입으로 쓴다.

```ts
// void, never

function sayHello(): void {
    console.log('hello');
}

function infLoop(): never{
    while (true) {
        // do something..
    }
}
```

## 열거형 (enum)

`enum`은 서로 관련 있는 값들을 이름으로 묶어 둔다. 값을 지정하지 않으면 `0`부터 차례로 번호가 붙고, 특정 값을 지정하면 그다음 멤버는 그 값에서 1씩 증가한다.

```ts
// enum

enum Os {
    Window,   // 0
    Ios,      // 1
    Android   // 2
}

enum Os2 {
    Window = 3, // 3
    Ios = 10,   // 10
    Android     // 11
}

console.log(Os['Ios']); // 1
console.log(Os[1]);     // Ios

let myOs: Os;
myOs = Os.Window;
console.log(myOs);      // 0
```

숫자 enum은 이름으로 값을 찾을 수도 있고(`Os['Ios']` → `1`), 값으로 이름을 찾을 수도 있다(`Os[1]` → `'Ios'`). 변수 타입을 `Os`로 지정하면 `Os`에 정의된 값만 넣을 수 있다.

## null과 undefined

`null`과 `undefined`도 각각 하나의 타입으로 쓸 수 있다.

```ts
// null, undefined

let a: null = null;
let b = undefined;
```

`a`는 `null` 외의 값을 담을 수 없다. `b`처럼 타입을 적지 않고 `undefined`로 초기화하면 이후에 다른 값을 넣을 수 있도록 `any`로 추론되므로, 의도한 타입이 있다면 직접 적어 주는 편이 좋다.
