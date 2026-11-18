---
layout: post
title: "TypeScript (7) - 유틸리티 타입"
date: 2026-11-19 00:30:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "유틸리티 타입", "utility types", "keyof", "Partial", "Record", "Pick", "Omit"]
---

## 유틸리티 타입이 필요한 이유

인터페이스를 하나 만들어 두면, 비슷하지만 조금 다른 타입이 계속 필요해진다. 모든 속성을 선택으로 바꾼 타입, 일부 속성만 뽑은 타입, 수정할 수 없는 타입 같은 것들이다. 이걸 매번 새 인터페이스로 다시 적으면 원본이 바뀔 때마다 여러 곳을 같이 고쳐야 한다.

TypeScript는 이런 변형을 위해 **유틸리티 타입**(Utility Types)을 기본으로 제공한다. 앞 글에서 본 제네릭처럼 `Partial<User>` 형태로 기존 타입을 꺾쇠 안에 넘기면, 변형된 새 타입을 돌려준다. 이 글에서는 자주 쓰는 유틸리티 타입과, 그 바탕이 되는 `keyof` 연산자를 차례로 살펴본다.

## keyof: 속성 이름을 유니온으로 뽑기

`keyof`는 유틸리티 타입은 아니지만, 여러 유틸리티 타입과 함께 자주 쓰이므로 먼저 알아 두면 좋다. 객체 타입 앞에 붙이면 그 타입의 **속성 이름들을 유니온 타입**으로 만들어 준다.

```ts
interface User {
    id: number;
    name: string;
    age: number;
    gender: "m" | "f";
}

type UserKey = keyof User; // 'id' | 'name' | 'age' | 'gender'

const uk: UserKey = "id";
```

`UserKey`는 `'id' | 'name' | 'age' | 'gender'` 네 문자열 리터럴의 유니온이다. 그래서 `uk`에는 `"id"`처럼 `User`에 실제로 있는 속성 이름만 넣을 수 있고, `"email"`처럼 없는 이름을 넣으면 에러가 난다.

## Partial<T>: 모든 속성을 선택으로

`Partial<T>`는 `T`의 모든 속성을 **선택 속성**(`?`)으로 바꾼다.

```ts
interface User {
    id: number;
    name: string;
    age: number;
    gender: "m" | "f";
}

let admin: Partial<User> = {
    id: 1,
    name: "Bob",
};
```

`User` 그대로라면 `age`와 `gender`가 빠져서 에러가 난다. `Partial<User>`는 아래 타입과 같기 때문에 일부 속성만 넣어도 통과한다.

```ts
interface PartialUser {
    id?: number;
    name?: string;
    age?: number;
    gender?: "m" | "f";
}
```

모든 속성이 선택이 될 뿐, 없는 속성까지 허용하는 것은 아니다. `job: ""`처럼 `User`에 없는 속성을 넣으면 여전히 에러가 난다. 객체의 일부만 수정하는 함수의 매개변수처럼, 값이 다 채워지지 않은 상태를 표현할 때 쓴다.

## Required<T>: 모든 속성을 필수로

`Required<T>`는 `Partial<T>`의 반대다. 선택 속성까지 모두 **필수 속성**으로 바꾼다.

```ts
interface User {
    id: number;
    name: string;
    age?: number;
}

let admin: Required<User> = {
    id: 1,
    name: "Bob",
    age: 30,
};
```

`User`의 `age`는 선택 속성이지만, `Required<User>`에서는 필수가 된다. 그래서 `age: 30`을 빼면 `Property 'age' is missing` 에러가 난다.

## Readonly<T>: 모든 속성을 읽기 전용으로

`Readonly<T>`는 모든 속성에 `readonly`를 붙인다. 처음 만들 때 값을 넣을 수는 있지만, 그 뒤에 바꿀 수는 없다.

```ts
interface User {
    id: number;
    name: string;
    age?: number;
}

let admin: Readonly<User> = {
    id: 1,
    name: "Bob",
};

admin.id = 4; // 에러
```

마지막 줄에서 `Cannot assign to 'id' because it is a read-only property` 에러가 난다. 5편의 클래스에서 속성 하나에 `readonly`를 붙였던 것을, 객체 타입 전체에 한 번에 적용한다고 보면 된다.

## Record<K, T>: 키와 값의 타입으로 객체 만들기

`Record<K, T>`는 **키 타입 `K`와 값 타입 `T`** 를 받아 객체 타입을 만든다. 학년별 성적을 담는 객체를 예로 들어 보자. 인터페이스로 직접 쓰면 이렇게 된다.

```ts
interface Score {
    "1": "A" | "B" | "C" | "D";
    "2": "A" | "B" | "C" | "D";
    "3": "A" | "B" | "C" | "D";
    "4": "A" | "B" | "C" | "D";
}
```

같은 값 타입이 네 번 반복된다. 키와 값을 각각 타입으로 빼고 `Record`로 묶으면 훨씬 짧아진다.

```ts
type Grade = "1" | "2" | "3" | "4";
type Score = "A" | "B" | "C" | "D" | "F";

const score: Record<Grade, Score> = {
    1: "A",
    2: "C",
    3: "B",
    4: "D",
};
```

`Record<Grade, Score>`는 "키는 `Grade` 중 하나, 값은 `Score` 중 하나인 객체"라는 뜻이다. `Grade`의 네 키가 모두 있어야 해서 `4: "D"`를 빼면 `Property '4' is missing` 에러가 나고, 값에 `"E"`처럼 `Score`에 없는 문자를 넣어도 에러가 난다. 학년이나 등급이 늘어나면 `Grade`, `Score`만 고치면 된다.

`Record`는 `keyof`와 함께 쓸 때 특히 유용하다. 사용자 정보의 각 속성이 올바른지 검사해 결과를 돌려주는 함수를 만들어 보자.

```ts
interface User {
    id: number;
    name: string;
    age: number;
}

function isValid(user: User) {
    const result: Record<keyof User, boolean> = {
        id: user.id > 0,
        name: user.name !== "",
        age: user.age > 0,
    };
    return result;
}
```

`keyof User`는 `'id' | 'name' | 'age'`이므로, `result`는 이 세 속성을 모두 가지고 값은 `boolean`인 객체가 된다. 나중에 `User`에 속성이 추가되면 `result`에 그 속성의 검사 결과가 빠졌다는 에러가 나서, 검사 로직을 빠뜨리지 않게 해 준다.

## Pick<T, K>: 일부 속성만 고르기

`Pick<T, K>`는 `T`에서 **`K`에 적은 속성만 골라** 새 타입을 만든다.

```ts
interface User {
    id: number;
    name: string;
    age: number;
    gender: "M" | "W";
}

const admin: Pick<User, "id" | "name"> = {
    id: 0,
    name: "Bob",
};
```

`Pick<User, "id" | "name">`은 `{ id: number; name: string }`과 같다. `K` 자리에는 `T`의 속성 이름만 올 수 있어서, `Pick<User, "email">`처럼 없는 속성을 적으면 에러가 난다.

## Omit<T, K>: 일부 속성만 빼기

`Omit<T, K>`는 `Pick`의 반대로, `T`에서 **`K`에 적은 속성을 뺀** 나머지로 새 타입을 만든다.

```ts
interface User {
    id: number;
    name: string;
    age: number;
    gender: "M" | "W";
}

const admin: Omit<User, "age" | "gender"> = {
    id: 0,
    name: "Bob",
};
```

`age`와 `gender`를 뺐으므로 결과는 앞의 `Pick<User, "id" | "name">`과 같은 `{ id: number; name: string }`이다. 남길 속성이 적으면 `Pick`, 뺄 속성이 적으면 `Omit`을 쓰면 선언이 짧아진다.

## Exclude<T1, T2>: 유니온에서 타입 빼기

지금까지는 객체 타입의 **속성**을 다뤘다. `Exclude<T1, T2>`는 유니온 타입에서 **`T2`에 해당하는 타입을 제거**한다.

```ts
type T1 = string | number | boolean;
type T2 = Exclude<T1, number | string>; // boolean
```

`T1`에서 `number`와 `string`을 빼서 `T2`는 `boolean`만 남는다.

`Omit`과 이름이 비슷해 헷갈리기 쉽다. `Omit`은 객체에서 **속성**을 빼고, `Exclude`는 유니온에서 **타입**을 뺀다.

## NonNullable<T>: null과 undefined 빼기

`NonNullable<T>`는 유니온 타입에서 `null`과 `undefined`를 제거한다.

```ts
type T1 = string | null | undefined | void;
type T2 = NonNullable<T1>;
```

`T2`에서는 `null`과 `undefined`가 빠진다. 그래서 `const a: T2 = null`이나 `const b: T2 = undefined`는 에러가 난다. 값이 비어 있을 수 있는 타입에서 "여기서는 반드시 값이 있다"는 타입을 따로 만들 때 쓴다.

`void`는 `null`, `undefined`와 다른 타입이라 이름 그대로 빠지지는 않고, TypeScript 버전에 따라 `void`나 `void & {}` 형태로 남는다. 다만 이렇게 남은 타입에도 `undefined`는 넣을 수 없다.

## 한눈에 보기

| 유틸리티 타입 | 대상 | 하는 일 |
| --- | --- | --- |
| `keyof T` | 객체 타입 | 속성 이름들을 유니온으로 만든다 (연산자) |
| `Partial<T>` | 객체 타입 | 모든 속성을 선택(`?`)으로 |
| `Required<T>` | 객체 타입 | 모든 속성을 필수로 |
| `Readonly<T>` | 객체 타입 | 모든 속성을 읽기 전용으로 |
| `Record<K, T>` | 키·값 타입 | 키가 `K`, 값이 `T`인 객체 타입을 만든다 |
| `Pick<T, K>` | 객체 타입 | `K` 속성만 남긴다 |
| `Omit<T, K>` | 객체 타입 | `K` 속성을 뺀다 |
| `Exclude<T1, T2>` | 유니온 타입 | `T2`에 해당하는 타입을 뺀다 |
| `NonNullable<T>` | 유니온 타입 | `null`, `undefined`를 뺀다 |

## 정리

유틸리티 타입은 이미 있는 타입을 바탕으로 변형된 타입을 만들어 주는 내장 제네릭 타입이다. 원본 인터페이스를 하나만 두고 필요한 모양을 그때그때 만들어 쓰므로, 원본이 바뀌면 파생된 타입도 함께 바뀐다.

`Partial`, `Required`, `Readonly`는 모든 속성의 성질을 한꺼번에 바꾸고, `Pick`과 `Omit`은 속성을 골라내거나 뺀다. `Record`는 키와 값의 타입으로 객체 타입을 만들며, `keyof`와 함께 쓰면 원본 타입의 속성을 빠짐없이 다루도록 강제할 수 있다.

`Exclude`와 `NonNullable`은 객체가 아니라 유니온 타입을 다룬다. `Exclude`는 원하는 타입을, `NonNullable`은 `null`과 `undefined`를 유니온에서 걸러낸다.
