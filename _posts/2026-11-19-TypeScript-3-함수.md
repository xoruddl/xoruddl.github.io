---
layout: post
title: "TypeScript (3) - 함수"
date: 2026-11-19 00:30:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "함수", "나머지 매개변수", "오버로드"]
---

## 매개변수와 반환 타입 지정

함수에도 변수처럼 타입을 붙일 수 있다. 매개변수 이름 뒤에 `: 타입`을 적어 어떤 값을 받을지 정하고, 괄호 뒤에 `: 타입`을 적어 무엇을 돌려줄지 정한다.

```ts
function add1(num1: number, num2: number): number {
    return num1 + num2;
}

function add2(num1: number, num2: number): void {
    console.log(num1 + num2);
}
```

`add1`은 두 수를 더한 값을 반환하므로 반환 타입이 `number`다. `add2`는 결과를 출력만 하고 아무것도 반환하지 않으므로 반환 타입이 `void`다.

반환 타입과 실제로 반환하는 값이 다르면 에러가 난다. 예를 들어 `add1`에서 `return 'hello';`라고 쓰면 `string`은 `number`에 넣을 수 없다는 컴파일 에러가 난다. 매개변수도 마찬가지로 `add1('1', 2)`처럼 문자열을 넘기면 에러가 난다.

반환 타입은 어떤 타입이든 될 수 있다. `isAdult`는 나이를 받아 성인인지를 `true` 또는 `false`로 알려 준다.

```ts
function isAdult(age: number): boolean {
    return age > 19;
}
```

`age > 19`는 비교 결과이므로 항상 `boolean`이다. `isAdult(30)`은 `true`, `isAdult(15)`는 `false`를 반환한다.

## 선택적 매개변수와 기본값

TypeScript는 함수를 호출할 때 인수 개수를 정확히 맞추도록 검사한다. 넘겨도 되고 안 넘겨도 되는 매개변수는 이름 뒤에 `?`를 붙여 **선택적 매개변수**로 만든다. 값을 넘기지 않았을 때 쓸 값을 미리 정해 두고 싶다면 `= 기본값`을 적는다.

```ts
function hello(name?: string) {
    return `Hello, ${name || "world"}`;
}

function hello2(name = 'world') {
    return `Hello, ${name}`;
}

const result = hello();
const result2 = hello("Sam");
```

`hello`의 `name`은 `string`이거나, 값을 넘기지 않으면 `undefined`가 된다. `name || "world"`는 `name`에 값이 없을 때 `"world"`를 대신 쓰라는 뜻이다. `hello2`는 같은 동작을 기본값으로 표현한 것이다. 기본값 `'world'`가 문자열이므로 `name`의 타입은 따로 적지 않아도 `string`으로 추론된다.

| 호출 | 반환 값 |
| --- | --- |
| `hello()` | `"Hello, world"` |
| `hello("Sam")` | `"Hello, Sam"` |
| `hello2()` | `"Hello, world"` |

`?`는 생략을 허용할 뿐, 타입 검사를 끄지는 않는다. `hello(123)`처럼 다른 타입을 넘기면 여전히 에러가 난다. 두 함수 모두 반환 타입을 적지 않았지만 템플릿 문자열을 반환하므로 `string`으로 추론되고, `const`로 선언한 `result`, `result2`의 타입도 `string`이 된다.

## 필수 매개변수와 선택적 매개변수 함께 쓰기

이름은 꼭 받고, 나이는 선택으로 받는 함수를 만들어 보자. 선택적 매개변수는 필수 매개변수 **뒤에** 와야 한다.

```ts
function hello(name: string, age?: number): string {
    if (age !== undefined) {
        return `Hello, ${name}. You are ${age}.`;
    } else {
        return `Hello, ${name}`;
    }
}

console.log(hello("Sam"));
console.log(hello("Sam", 30));
```

실행하면 다음과 같이 출력된다.

```
Hello, Sam
Hello, Sam. You are 30.
```

`age`는 넘기지 않으면 `undefined`이므로, `age !== undefined`로 값이 있는지 먼저 확인한 뒤 사용한다.

순서를 바꿔 `function hello(age?: number, name: string)`처럼 쓰면 "필수 매개변수는 선택적 매개변수 뒤에 올 수 없다"는 에러가 난다. 첫 번째 인수를 생략하고 두 번째만 넘기는 방법이 없기 때문이다. 꼭 나이를 앞에 두고 싶다면 `age: number | undefined`로 선언하고, 호출할 때 `hello(undefined, "Sam")`처럼 `undefined`를 명시적으로 넘겨야 한다.

## 나머지 매개변수

인수를 몇 개 받을지 정해져 있지 않을 때는 매개변수 앞에 `...`을 붙인다. 이를 **나머지 매개변수**(rest parameter)라고 하며, 넘어온 인수들이 하나의 배열로 모인다.

```ts
function add(...nums: number[]) {
    return nums.reduce((result, num) => result + num, 0);
}

add(1, 2, 3); // 6
add(1, 2, 3, 4, 5); // 15
```

인수가 배열로 모이므로 타입도 `number[]`처럼 배열 타입으로 적는다. `reduce`는 배열의 요소를 처음부터 하나씩 꺼내 `result`에 더해 가고, `0`은 더하기를 시작할 초깃값이다. `add('1', 2)`처럼 숫자가 아닌 값을 섞으면 에러가 난다.

## this의 타입 지정

함수 안에서 `this`를 쓰면 TypeScript는 `this`가 무엇을 가리키는지 알 수 없다. 이때 첫 번째 매개변수 자리에 `this: 타입`을 적어 `this`의 타입을 알려 준다.

```ts
interface User {
    name: string;
}

const Sam: User = {name: 'Sam'}

function showName(this: User, age: number, gender: 'm' | 'f') {
    console.log(this.name, age, gender);
}

const a = showName.bind(Sam);
a(30, 'm');
```

`this: User`는 진짜 매개변수가 아니다. 타입 검사용 표시일 뿐이라 호출할 때는 빼고 생각한다. 그래서 `a(30, 'm')`처럼 나머지 매개변수 `age`, `gender`만 넘긴다.

`bind(Sam)`은 `this`가 `Sam`을 가리키도록 고정한 새 함수를 만든다. 실행하면 `Sam 30 m`이 출력된다. `gender`는 `'m' | 'f'` 유니온 타입이므로 `a(30, 'x')`처럼 다른 문자열을 넘기면 에러가 난다.

## 함수 오버로드

같은 함수라도 넘기는 인수의 타입에 따라 반환 타입이 달라질 수 있다. 이런 경우를 TypeScript에 정확히 알려 주는 방법이 **함수 오버로드**다. 본문 없는 함수 선언을 여러 개 먼저 적고, 마지막에 실제 구현을 하나 적는다.

```ts
interface User {
    name: string;
    age: number;
}

function join(name: string, age: number): User;
function join(name: string, age: string): string;
function join(name: string, age: number | string): User | string {
    if (typeof age === "number") {
        return {
            name,
            age,
        };
    } else {
        return "나이는 숫자로 입력해주세요.";
    }
}

const sam: User = join("Sam", 30);
const jane: string = join("Jane", "30");
```

위의 두 줄이 오버로드 선언이고, 세 번째 `join`이 실제로 실행되는 구현이다. 각 줄의 역할은 다음과 같다.

| 선언 | 의미 |
| --- | --- |
| `join(name: string, age: number): User` | `age`에 숫자를 넘기면 `User` 객체를 반환한다. |
| `join(name: string, age: string): string` | `age`에 문자열을 넘기면 문자열을 반환한다. |
| `join(name: string, age: number \| string): User \| string` | 두 경우를 모두 처리하는 실제 구현이다. |

구현부의 `typeof age === "number"`가 `age`의 타입을 확인해 반환 값을 나눈다. 숫자면 `{ name, age }` 객체를, 아니면 안내 문자열을 반환한다. `{ name, age }`는 `{ name: name, age: age }`를 줄여 쓴 것이다.

오버로드가 없다면 `join`의 반환 타입은 `User | string`이 된다. 그러면 `const sam: User = join("Sam", 30);`에서 "`string`일 수도 있는 값을 `User`에 넣을 수 없다"는 에러가 난다. 오버로드를 선언해 두면 TypeScript가 인수 타입을 보고 알맞은 반환 타입을 골라 주므로 `sam`과 `jane`에 각각 `User`, `string` 타입을 붙일 수 있다.

## 정리

함수에는 매개변수와 반환 타입을 지정할 수 있다. 반환 값이 없으면 `void`를 쓴다. 생략할 수 있는 매개변수는 `?`나 기본값으로 만들고, 선택적 매개변수는 필수 매개변수 뒤에 둔다. 개수가 정해지지 않은 인수는 `...`과 배열 타입으로 받는다.

함수 안에서 `this`를 쓸 때는 첫 번째 매개변수 자리에 `this`의 타입을 적는다. 인수 타입에 따라 반환 타입이 달라지는 함수는 오버로드로 경우마다 선언해 두면, 호출하는 쪽에서 정확한 타입을 얻을 수 있다.
