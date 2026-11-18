---
layout: post
title: "TypeScript (6) - 제네릭"
date: 2026-11-19 00:30:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "제네릭", "generics", "타입 매개변수", "제네릭 제약"]
---

## 제네릭이 필요한 이유

함수나 인터페이스를 만들다 보면 "동작은 똑같은데 다루는 타입만 다른" 경우가 자주 생긴다. 이때 타입마다 코드를 따로 만들거나 유니온 타입을 계속 늘리는 대신, 타입 자체를 매개변수처럼 받아서 쓰는 방법이 **제네릭**(Generics)이다. 함수에 값을 인자로 넘기듯, 타입을 사용하는 쪽에서 넘겨주는 것이다.

## 유니온 타입으로 해결할 때의 한계

배열을 받아 길이를 돌려주는 함수를 만들어 보자. 숫자 배열과 문자열 배열을 모두 받으려면 유니온 타입을 쓸 수 있다.

```ts
function getSize(arr: number[] | string[]): number {
    return arr.length;
}

const arr1 = [1, 2, 3];
getSize(arr1); // 3

const arr2 = ["a", "b", "c"];
getSize(arr2); // 3
```

여기까지는 문제없다. 그런데 불리언 배열도 받고 싶다면 매개변수 타입을 `number[] | string[] | boolean[]`로 고쳐야 하고, 객체 배열이 추가되면 또 고쳐야 한다. 함수가 하는 일은 `arr.length`를 돌려주는 것뿐인데, 받을 타입이 늘어날 때마다 선언이 길어진다.

## 타입 매개변수 T

제네릭을 쓰면 이 함수를 한 번만 선언하면 된다.

```ts
function getSize<T>(arr: T[]): number {
    return arr.length;
}

const arr1 = [1, 2, 3];
getSize<number | string>(arr1); // 3

const arr2 = ["a", "b", "c"];
getSize<string>(arr2); // 3

const arr3 = [false, true, true];
getSize(arr3); // 3
```

함수 이름 뒤의 `<T>`를 **타입 매개변수**(type parameter)라고 한다. `T`는 "아직 정해지지 않은 어떤 타입"을 가리키는 이름이고, `arr: T[]`는 "`T` 타입 요소들의 배열"이라는 뜻이다. `T`라는 이름은 관례일 뿐이라 다른 이름을 써도 된다.

`T`가 실제로 어떤 타입이 될지는 함수를 **호출할 때** 정해진다.

| 호출 | `T`로 정해지는 타입 | 결정 방식 |
| --- | --- | --- |
| `getSize<number \| string>(arr1)` | `number \| string` | 직접 지정 |
| `getSize<string>(arr2)` | `string` | 직접 지정 |
| `getSize(arr3)` | `boolean` | 인자를 보고 추론 |

`getSize<string>(arr2)`처럼 꺾쇠 안에 타입을 직접 적을 수도 있고, `getSize(arr3)`처럼 생략할 수도 있다. 생략하면 TypeScript가 넘겨준 인자 `arr3`가 `boolean[]`인 것을 보고 `T`를 `boolean`으로 추론한다.

`getSize<number | string>(arr1)`처럼 실제 값보다 넓은 타입을 지정해도 된다. `number[]`인 `arr1`은 `(number | string)[]`에 들어갈 수 있기 때문이다. 반대로 `getSize<string>(arr1)`처럼 맞지 않는 타입을 지정하면 `number[]`를 `string[]`에 넣을 수 없다는 에러가 난다.

## 인터페이스에 제네릭 사용하기

제네릭은 함수뿐 아니라 인터페이스에도 쓸 수 있다. 휴대폰 정보를 담는 인터페이스에서 `option` 속성만 제품마다 형태가 다르다고 해 보자.

```ts
interface Mobile<T> {
    name: string;
    price: number;
    option: T;
}
```

`name`과 `price`는 타입이 고정되어 있고, `option`의 타입은 `T`로 비워 두었다. `Mobile`을 사용할 때 `Mobile<...>`의 꺾쇠 안에 `option`의 타입을 넣어 준다.

```ts
const m1: Mobile<{ color: string; coupon: boolean }> = {
    name: "s21",
    price: 1000,
    option: {
        color: "red",
        coupon: false,
    },
};

const m2: Mobile<string> = {
    name: "s20",
    price: 900,
    option: "good",
};
```

`m1`은 `T`가 `{ color: string; coupon: boolean }`이므로 `option`에 색상과 쿠폰 여부를 담은 객체를 넣는다. `m2`는 `T`가 `string`이므로 `option`에 문자열을 넣는다. 인터페이스는 하나지만 `option` 자리의 타입만 바꿔 가며 쓸 수 있다.

타입 검사도 그대로 적용된다. `m1`의 옵션 객체에 `coupon` 대신 `cooupon`처럼 오타를 내거나, `m2`에서 `option` 대신 `options`라고 쓰면 선언된 타입과 맞지 않는다는 에러가 난다.

## 타입 매개변수에 제약 걸기: extends

이번에는 객체를 받아 `name` 속성을 돌려주는 함수를 만들어 보자. 다음 세 인터페이스 중 `User`와 `Car`에는 `name`이 있고 `Book`에는 없다.

```ts
interface User {
    name: string;
    age: number;
}

interface Car {
    name: string;
    color: string;
}

interface Book {
    price: number;
}

const user: User = { name: "a", age: 10 };
const car: Car = { name: "bmw", color: "red" };
const book: Book = { price: 3000 };
```

`T`를 아무 타입이나 받도록 두면 함수 안에서 `data.name`을 쓸 수 없다. `T`에 `name`이 있다는 보장이 없기 때문이다. 이럴 때 `extends`로 `T`가 될 수 있는 타입에 조건을 건다. 이를 **제네릭 제약**(generic constraint)이라고 한다.

```ts
function showName<T extends { name: string }>(data: T): string {
    return data.name;
}

showName(user); // "a"
showName(car);  // "bmw"
showName(book); // 에러
```

`T extends { name: string }`은 "`T`는 어떤 타입이든 되지만, 최소한 `string` 타입의 `name` 속성은 가지고 있어야 한다"는 뜻이다. 그래서 함수 안에서 `data.name`을 안심하고 쓸 수 있다.

`user`와 `car`는 `age`, `color`처럼 다른 속성이 더 있어도 `name: string`을 가지고 있으므로 통과한다. `book`에는 `name`이 없어서, `Book` 타입에 `name` 속성이 없으므로 `{ name: string }` 타입 매개변수에 넘길 수 없다는 에러가 난다.

## 정리

제네릭은 타입을 매개변수처럼 받아서, 같은 동작을 여러 타입에 재사용하게 해 주는 기능이다. 함수 이름 뒤에 `<T>`를 붙이고, 호출할 때 `getSize<string>(arr)`처럼 타입을 직접 넘기거나 생략해서 인자로부터 추론하게 한다.

인터페이스에도 `Mobile<T>`처럼 타입 매개변수를 둘 수 있다. 공통 속성은 고정하고 달라지는 부분만 `T`로 비워 두면, 사용할 때 `Mobile<string>`처럼 그 자리의 타입을 정해 쓸 수 있다.

`T extends { name: string }`처럼 `extends`로 제약을 걸면, `T`가 반드시 가져야 할 형태를 정할 수 있다. 덕분에 함수 안에서 해당 속성을 안전하게 사용하고, 조건에 맞지 않는 인자는 컴파일 단계에서 걸러낸다.
